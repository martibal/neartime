create extension if not exists pgcrypto;

create table if not exists public.api_cost_policy (
  service text primary key,
  external_calls_enabled boolean not null default false,
  emergency_kill_switch boolean not null default true,
  max_estimated_units_per_call integer not null default 0 check (max_estimated_units_per_call >= 0),
  global_daily_units integer not null default 0 check (global_daily_units >= 0),
  global_monthly_units integer not null default 0 check (global_monthly_units >= 0),
  per_device_daily_units integer not null default 0 check (per_device_daily_units >= 0),
  max_requests_per_minute_per_device integer not null default 0 check (max_requests_per_minute_per_device >= 0),
  updated_at timestamptz not null default now()
);

insert into public.api_cost_policy (
  service,
  external_calls_enabled,
  emergency_kill_switch,
  max_estimated_units_per_call,
  global_daily_units,
  global_monthly_units,
  per_device_daily_units,
  max_requests_per_minute_per_device
) values (
  'places-nearby-enterprise-atmosphere',
  false,
  true,
  0,
  0,
  0,
  0,
  0
)
on conflict (service) do nothing;

create table if not exists public.api_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  device_id text not null check (length(device_id) between 1 and 128),
  service text not null references public.api_cost_policy(service),
  estimated_units integer not null check (estimated_units > 0),
  status text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  finished_at timestamptz
);

create index if not exists api_cost_reservations_service_reserved_at_idx
  on public.api_cost_reservations (service, reserved_at desc);
create index if not exists api_cost_reservations_device_reserved_at_idx
  on public.api_cost_reservations (device_id, reserved_at desc);

alter table public.api_cost_policy enable row level security;
alter table public.api_cost_reservations enable row level security;

create or replace function public.reserve_api_cost(
  p_device_id text,
  p_service text,
  p_estimated_units integer
)
returns table (allowed boolean, reason text, reservation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.api_cost_policy%rowtype;
  v_now timestamptz := clock_timestamp();
  v_global_daily bigint;
  v_global_monthly bigint;
  v_device_daily bigint;
  v_device_minute bigint;
  v_reservation_id uuid;
begin
  if p_device_id is null or length(trim(p_device_id)) = 0 or length(p_device_id) > 128 then
    return query select false, 'invalid_device_id'::text, null::uuid;
    return;
  end if;

  if p_estimated_units is null or p_estimated_units <= 0 then
    return query select false, 'invalid_cost_estimate'::text, null::uuid;
    return;
  end if;

  select * into v_policy
  from public.api_cost_policy
  where service = p_service
  for update;

  if not found then
    return query select false, 'service_not_configured'::text, null::uuid;
    return;
  end if;

  if not v_policy.external_calls_enabled then
    return query select false, 'external_calls_disabled'::text, null::uuid;
    return;
  end if;

  if v_policy.emergency_kill_switch then
    return query select false, 'kill_switch_active'::text, null::uuid;
    return;
  end if;

  if p_estimated_units > v_policy.max_estimated_units_per_call then
    return query select false, 'per_call_limit'::text, null::uuid;
    return;
  end if;

  select coalesce(sum(estimated_units), 0) into v_global_daily
  from public.api_cost_reservations
  where service = p_service
    and reserved_at >= date_trunc('day', v_now)
    and (status = 'committed' or (status = 'reserved' and expires_at > v_now));

  if v_global_daily + p_estimated_units > v_policy.global_daily_units then
    return query select false, 'global_daily_limit'::text, null::uuid;
    return;
  end if;

  select coalesce(sum(estimated_units), 0) into v_global_monthly
  from public.api_cost_reservations
  where service = p_service
    and reserved_at >= date_trunc('month', v_now)
    and (status = 'committed' or (status = 'reserved' and expires_at > v_now));

  if v_global_monthly + p_estimated_units > v_policy.global_monthly_units then
    return query select false, 'global_monthly_limit'::text, null::uuid;
    return;
  end if;

  select coalesce(sum(estimated_units), 0) into v_device_daily
  from public.api_cost_reservations
  where service = p_service
    and device_id = p_device_id
    and reserved_at >= date_trunc('day', v_now)
    and (status = 'committed' or (status = 'reserved' and expires_at > v_now));

  if v_device_daily + p_estimated_units > v_policy.per_device_daily_units then
    return query select false, 'device_daily_limit'::text, null::uuid;
    return;
  end if;

  select count(*) into v_device_minute
  from public.api_cost_reservations
  where service = p_service
    and device_id = p_device_id
    and reserved_at >= v_now - interval '1 minute'
    and (status = 'committed' or (status = 'reserved' and expires_at > v_now));

  if v_device_minute >= v_policy.max_requests_per_minute_per_device then
    return query select false, 'device_rate_limit'::text, null::uuid;
    return;
  end if;

  insert into public.api_cost_reservations (device_id, service, estimated_units, reserved_at, expires_at)
  values (p_device_id, p_service, p_estimated_units, v_now, v_now + interval '5 minutes')
  returning id into v_reservation_id;

  return query select true, 'reserved'::text, v_reservation_id;
end;
$$;

create or replace function public.finish_api_cost_reservation(
  p_reservation_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_status not in ('committed', 'released') then
    return false;
  end if;

  update public.api_cost_reservations
  set status = p_status,
      finished_at = clock_timestamp()
  where id = p_reservation_id
    and status = 'reserved';

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on public.api_cost_policy from anon, authenticated;
revoke all on public.api_cost_reservations from anon, authenticated;
revoke all on function public.reserve_api_cost(text, text, integer) from public, anon, authenticated;
revoke all on function public.finish_api_cost_reservation(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_api_cost(text, text, integer) to service_role;
grant execute on function public.finish_api_cost_reservation(uuid, text) to service_role;

comment on table public.api_cost_policy is 'Authoritative fail-closed policy. External provider calls require an atomic reservation against this row.';
comment on table public.api_cost_reservations is 'Reservation ledger for billable external API calls. Reserved units count until committed, released, or expired.';
