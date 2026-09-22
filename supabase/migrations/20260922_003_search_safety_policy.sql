-- Provider-spend safety controls for WayNear search.
-- Applied before any paid Google Places provider call.
-- Defaults are intentionally conservative for early production:
--   * minimum 3 seconds between new search requests per anonymous device
--   * maximum 60 new search requests per device per rolling hour
--   * maximum 120 new search requests per device per rolling 24 hours
--   * maximum NOK 100 of reserved provider cost per UTC day globally
-- At the current conservative NOK 0.40/search ceiling, the global cap permits
-- at most 250 provider-bound searches/day before failing closed.

create table if not exists public.neartime_search_safety_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  min_interval_ms integer not null default 3000 check (min_interval_ms between 0 and 60000),
  max_requests_per_hour integer not null default 60 check (max_requests_per_hour > 0),
  max_requests_per_day integer not null default 120 check (max_requests_per_day > 0),
  global_daily_cost_cap_nok numeric(12,2) not null default 100.00 check (global_daily_cost_cap_nok > 0),
  reserved_cost_per_search_nok numeric(12,4) not null default 0.40 check (reserved_cost_per_search_nok > 0),
  updated_at timestamptz not null default now()
);

insert into public.neartime_search_safety_policy(
  singleton,
  enabled,
  min_interval_ms,
  max_requests_per_hour,
  max_requests_per_day,
  global_daily_cost_cap_nok,
  reserved_cost_per_search_nok
)
values (true, true, 3000, 60, 120, 100.00, 0.40)
on conflict (singleton) do nothing;

create table if not exists public.neartime_search_throttle_events (
  request_id uuid primary key,
  install_hash text not null check (length(install_hash) = 64),
  reserved_cost_nok numeric(12,4) not null check (reserved_cost_nok >= 0),
  created_at timestamptz not null default now()
);

create index if not exists neartime_search_throttle_events_install_time_idx
  on public.neartime_search_throttle_events(install_hash, created_at desc);

create index if not exists neartime_search_throttle_events_time_idx
  on public.neartime_search_throttle_events(created_at desc);

alter table public.neartime_search_safety_policy enable row level security;
alter table public.neartime_search_throttle_events enable row level security;

revoke all on public.neartime_search_safety_policy from public, anon, authenticated;
revoke all on public.neartime_search_throttle_events from public, anon, authenticated;

grant select, insert, update on public.neartime_search_safety_policy to service_role;
grant select, insert on public.neartime_search_throttle_events to service_role;

create or replace function public.neartime_search_safety_gate(
  p_install_hash text,
  p_request_id uuid
)
returns table (
  allowed boolean,
  reason text,
  retry_after_ms integer,
  requests_last_hour integer,
  requests_last_day integer,
  reserved_cost_today_nok numeric,
  global_daily_cost_cap_nok numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.neartime_search_safety_policy%rowtype;
  v_last_at timestamptz;
  v_hour_count integer := 0;
  v_day_count integer := 0;
  v_cost_today numeric := 0;
  v_retry_ms integer := 0;
begin
  if p_install_hash is null or length(p_install_hash) <> 64 then
    return query select false, 'invalid_install_hash', 0, 0, 0, 0::numeric, 0::numeric;
    return;
  end if;
  if p_request_id is null then
    return query select false, 'invalid_request_id', 0, 0, 0, 0::numeric, 0::numeric;
    return;
  end if;

  select * into v_policy
  from public.neartime_search_safety_policy
  where singleton = true;

  if not found or not v_policy.enabled then
    return query select true, 'safety_disabled', 0, 0, 0, 0::numeric,
      coalesce(v_policy.global_daily_cost_cap_nok, 0);
    return;
  end if;

  -- Serialize the small admission-control critical section so two simultaneous
  -- taps cannot both reserve cost before either is visible to the other.
  perform pg_advisory_xact_lock(92722026);

  -- A retry of the exact same logical request remains admissible; downstream
  -- idempotency owns replay semantics and prevents a second provider charge.
  if exists (
    select 1
    from public.neartime_search_throttle_events
    where request_id = p_request_id
  ) then
    select count(*) into v_hour_count
    from public.neartime_search_throttle_events
    where install_hash = p_install_hash
      and created_at >= now() - interval '1 hour';

    select count(*) into v_day_count
    from public.neartime_search_throttle_events
    where install_hash = p_install_hash
      and created_at >= now() - interval '24 hours';

    select coalesce(sum(reserved_cost_nok), 0) into v_cost_today
    from public.neartime_search_throttle_events
    where created_at >= date_trunc('day', now());

    return query select true, 'idempotent_replay', 0, v_hour_count, v_day_count,
      v_cost_today, v_policy.global_daily_cost_cap_nok;
    return;
  end if;

  select max(created_at) into v_last_at
  from public.neartime_search_throttle_events
  where install_hash = p_install_hash;

  if v_last_at is not null
     and v_last_at > now() - make_interval(secs => v_policy.min_interval_ms / 1000.0) then
    v_retry_ms := greatest(
      ceil(v_policy.min_interval_ms -
        extract(epoch from (now() - v_last_at)) * 1000)::integer,
      1
    );
    return query select false, 'rate_limited', v_retry_ms, 0, 0, 0::numeric,
      v_policy.global_daily_cost_cap_nok;
    return;
  end if;

  select count(*) into v_hour_count
  from public.neartime_search_throttle_events
  where install_hash = p_install_hash
    and created_at >= now() - interval '1 hour';

  if v_hour_count >= v_policy.max_requests_per_hour then
    return query select false, 'device_hourly_limit', 60000, v_hour_count, 0, 0::numeric,
      v_policy.global_daily_cost_cap_nok;
    return;
  end if;

  select count(*) into v_day_count
  from public.neartime_search_throttle_events
  where install_hash = p_install_hash
    and created_at >= now() - interval '24 hours';

  if v_day_count >= v_policy.max_requests_per_day then
    return query select false, 'device_daily_limit', 3600000, v_hour_count, v_day_count, 0::numeric,
      v_policy.global_daily_cost_cap_nok;
    return;
  end if;

  select coalesce(sum(reserved_cost_nok), 0) into v_cost_today
  from public.neartime_search_throttle_events
  where created_at >= date_trunc('day', now());

  if v_cost_today + v_policy.reserved_cost_per_search_nok > v_policy.global_daily_cost_cap_nok then
    return query select false, 'global_daily_cost_cap', 3600000, v_hour_count, v_day_count,
      v_cost_today, v_policy.global_daily_cost_cap_nok;
    return;
  end if;

  insert into public.neartime_search_throttle_events(
    request_id,
    install_hash,
    reserved_cost_nok
  )
  values (
    p_request_id,
    p_install_hash,
    v_policy.reserved_cost_per_search_nok
  );

  v_hour_count := v_hour_count + 1;
  v_day_count := v_day_count + 1;
  v_cost_today := v_cost_today + v_policy.reserved_cost_per_search_nok;

  return query select true, 'allowed', 0, v_hour_count, v_day_count,
    v_cost_today, v_policy.global_daily_cost_cap_nok;
end;
$$;

revoke all on function public.neartime_search_safety_gate(text, uuid)
  from public, anon, authenticated;
grant execute on function public.neartime_search_safety_gate(text, uuid)
  to service_role;

comment on table public.neartime_search_safety_policy is
  'Server-side admission controls that fail closed before provider-bound search calls.';
comment on table public.neartime_search_throttle_events is
  'One conservative provider-cost reservation per unique logical search request.';
