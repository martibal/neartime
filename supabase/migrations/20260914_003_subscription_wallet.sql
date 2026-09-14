-- Subscription wallet + entitlement identity + idempotent search accounting.
-- Everything is fail-closed until verified store products are configured.

alter table public.api_cost_policy
  add column if not exists per_entitlement_daily_units integer not null default 0 check (per_entitlement_daily_units >= 0),
  add column if not exists max_requests_per_minute_per_entitlement integer not null default 0 check (max_requests_per_minute_per_entitlement >= 0);

create table if not exists public.wallet (
  entitlement_hash text primary key check (length(entitlement_hash) between 32 and 128),
  platform text not null check (platform in ('ios', 'android')),
  product_id text,
  billing_period_start timestamptz not null,
  billing_period_end timestamptz not null,
  status text not null check (status in ('active', 'grace', 'expired', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entitlement_aliases (
  external_id_hash text primary key check (length(external_id_hash) between 32 and 128),
  entitlement_hash text not null references public.wallet(entitlement_hash) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_plan_policy (
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  included_units integer not null default 0 check (included_units >= 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (platform, product_id)
);

create table if not exists public.wallet_topup_policy (
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  topup_units integer not null default 0 check (topup_units > 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (platform, product_id)
);

create table if not exists public.wallet_entries (
  id uuid primary key default gen_random_uuid(),
  entitlement_hash text not null references public.wallet(entitlement_hash) on delete cascade,
  kind text not null check (kind in (
    'included_allocation', 'topup_purchase',
    'reservation', 'reservation_release', 'usage_commit'
  )),
  units integer not null check (units <> 0),
  reservation_id uuid references public.api_cost_reservations(id),
  funding_entry_id uuid references public.wallet_entries(id),
  idempotency_key text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind in ('included_allocation', 'topup_purchase', 'reservation_release') and units > 0)
    or
    (kind in ('reservation', 'usage_commit') and units < 0)
  ),
  check ((kind = 'usage_commit' and funding_entry_id is not null) or (kind <> 'usage_commit' and funding_entry_id is null))
);

create unique index if not exists wallet_entries_unique_idempotent_credit_idx
  on public.wallet_entries (entitlement_hash, kind, idempotency_key)
  where idempotency_key is not null and kind in ('included_allocation', 'topup_purchase');

create unique index if not exists wallet_entries_reservation_audit_idx
  on public.wallet_entries (reservation_id, kind)
  where reservation_id is not null and kind in ('reservation', 'reservation_release');

create unique index if not exists wallet_entries_usage_funding_idx
  on public.wallet_entries (reservation_id, funding_entry_id)
  where reservation_id is not null and kind = 'usage_commit';

create table if not exists public.entitlement_sessions (
  token_hash text primary key check (length(token_hash) = 64),
  entitlement_hash text not null references public.wallet(entitlement_hash) on delete cascade,
  device_id text not null check (length(device_id) between 1 and 128),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists entitlement_sessions_entitlement_idx
  on public.entitlement_sessions (entitlement_hash, expires_at desc);

create table if not exists public.search_requests (
  entitlement_hash text not null references public.wallet(entitlement_hash) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  device_id text not null check (length(device_id) between 1 and 128),
  request_hash text not null check (length(request_hash) = 64),
  status text not null default 'in_progress' check (status in ('in_progress', 'succeeded', 'failed')),
  reservation_id uuid references public.api_cost_reservations(id),
  response_payload jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (entitlement_hash, idempotency_key)
);

alter table public.api_cost_reservations
  add column if not exists entitlement_hash text references public.wallet(entitlement_hash),
  add column if not exists idempotency_key text;

create index if not exists api_cost_reservations_entitlement_reserved_at_idx
  on public.api_cost_reservations (entitlement_hash, reserved_at desc);

create or replace function public.wallet_available_balance(p_entitlement_hash text)
returns bigint
language sql
security definer
set search_path = public
as $$
  with credit_remaining as (
    select c.id,
           c.units - coalesce(sum(-u.units), 0)::bigint as remaining
    from public.wallet_entries c
    left join public.wallet_entries u
      on u.funding_entry_id = c.id and u.kind = 'usage_commit'
    where c.entitlement_hash = p_entitlement_hash
      and c.kind in ('included_allocation', 'topup_purchase')
      and (c.expires_at is null or c.expires_at > now())
    group by c.id, c.units
  ), active_reservations as (
    select coalesce(sum(r.estimated_units), 0)::bigint as reserved
    from public.api_cost_reservations r
    where r.entitlement_hash = p_entitlement_hash
      and r.status = 'reserved'
      and r.expires_at > now()
  )
  select greatest(0::bigint,
    coalesce((select sum(greatest(remaining, 0)) from credit_remaining), 0::bigint)
    - coalesce((select reserved from active_reservations), 0::bigint)
  );
$$;

create or replace view public.wallet_balance as
select
  w.entitlement_hash,
  w.platform,
  w.product_id,
  w.status,
  w.billing_period_start,
  w.billing_period_end,
  public.wallet_available_balance(w.entitlement_hash) as balance
from public.wallet w;

alter table public.wallet enable row level security;
alter table public.entitlement_aliases enable row level security;
alter table public.wallet_plan_policy enable row level security;
alter table public.wallet_topup_policy enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.entitlement_sessions enable row level security;
alter table public.search_requests enable row level security;

revoke all on public.wallet from anon, authenticated;
revoke all on public.entitlement_aliases from anon, authenticated;
revoke all on public.wallet_plan_policy from anon, authenticated;
revoke all on public.wallet_topup_policy from anon, authenticated;
revoke all on public.wallet_entries from anon, authenticated;
revoke all on public.entitlement_sessions from anon, authenticated;
revoke all on public.search_requests from anon, authenticated;
revoke all on function public.wallet_available_balance(text) from public, anon, authenticated;
grant execute on function public.wallet_available_balance(text) to service_role;

create or replace function public.upsert_verified_entitlement(
  p_platform text,
  p_external_id_hash text,
  p_linked_external_id_hash text,
  p_proposed_entitlement_hash text,
  p_product_id text,
  p_billing_period_start timestamptz,
  p_billing_period_end timestamptz,
  p_status text
)
returns table (entitlement_hash text, balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement_hash text;
  v_included_units integer := 0;
  v_allocation_key text;
begin
  if p_platform not in ('ios', 'android') or p_status not in ('active', 'grace', 'expired', 'refunded') then
    raise exception 'invalid entitlement state';
  end if;
  if p_external_id_hash is null or p_proposed_entitlement_hash is null then raise exception 'missing entitlement hash'; end if;
  if p_billing_period_start is null or p_billing_period_end is null or p_billing_period_end <= p_billing_period_start then
    raise exception 'invalid billing period';
  end if;

  select ea.entitlement_hash into v_entitlement_hash
    from public.entitlement_aliases ea where ea.external_id_hash = p_external_id_hash;
  if v_entitlement_hash is null and p_linked_external_id_hash is not null then
    select ea.entitlement_hash into v_entitlement_hash
      from public.entitlement_aliases ea where ea.external_id_hash = p_linked_external_id_hash;
  end if;
  v_entitlement_hash := coalesce(v_entitlement_hash, p_proposed_entitlement_hash);

  insert into public.wallet (entitlement_hash, platform, product_id, billing_period_start, billing_period_end, status)
  values (v_entitlement_hash, p_platform, p_product_id, p_billing_period_start, p_billing_period_end, p_status)
  on conflict (entitlement_hash) do update
  set product_id = excluded.product_id,
      billing_period_start = excluded.billing_period_start,
      billing_period_end = excluded.billing_period_end,
      status = excluded.status,
      updated_at = now();

  insert into public.entitlement_aliases (external_id_hash, entitlement_hash, platform)
  values (p_external_id_hash, v_entitlement_hash, p_platform)
  on conflict (external_id_hash) do update set entitlement_hash = excluded.entitlement_hash;

  if p_linked_external_id_hash is not null then
    insert into public.entitlement_aliases (external_id_hash, entitlement_hash, platform)
    values (p_linked_external_id_hash, v_entitlement_hash, p_platform)
    on conflict (external_id_hash) do update set entitlement_hash = excluded.entitlement_hash;
  end if;

  if p_status in ('active', 'grace') and p_product_id is not null then
    select included_units into v_included_units
      from public.wallet_plan_policy
      where platform = p_platform and product_id = p_product_id and enabled = true;
    v_included_units := coalesce(v_included_units, 0);
    if v_included_units > 0 then
      v_allocation_key := 'period:' || extract(epoch from p_billing_period_start)::bigint::text || ':' || p_product_id;
      insert into public.wallet_entries (entitlement_hash, kind, units, idempotency_key, expires_at)
      values (v_entitlement_hash, 'included_allocation', v_included_units, v_allocation_key, p_billing_period_end)
      on conflict do nothing;
    end if;
  end if;

  return query select v_entitlement_hash, public.wallet_available_balance(v_entitlement_hash);
end;
$$;

create or replace function public.create_entitlement_session(
  p_entitlement_hash text,
  p_token_hash text,
  p_device_id text,
  p_ttl_minutes integer default 10080
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallet%rowtype;
begin
  if p_ttl_minutes < 5 or p_ttl_minutes > 43200 then return false; end if;
  select * into v_wallet from public.wallet where entitlement_hash = p_entitlement_hash for update;
  if not found or v_wallet.status not in ('active', 'grace') then return false; end if;
  insert into public.entitlement_sessions (token_hash, entitlement_hash, device_id, expires_at)
  values (p_token_hash, p_entitlement_hash, p_device_id, now() + make_interval(mins => p_ttl_minutes));
  return true;
end;
$$;

create or replace function public.resolve_entitlement_session(p_token_hash text)
returns table (entitlement_hash text, status text, balance bigint)
language sql
security definer
set search_path = public
as $$
  select w.entitlement_hash, w.status, public.wallet_available_balance(w.entitlement_hash)
  from public.entitlement_sessions s
  join public.wallet w on w.entitlement_hash = s.entitlement_hash
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and w.status in ('active', 'grace');
$$;

create or replace function public.reserve_wallet_api_cost(
  p_entitlement_hash text,
  p_device_id text,
  p_service text,
  p_estimated_units integer,
  p_idempotency_key text,
  p_request_hash text
)
returns table (allowed boolean, reason text, reservation_id uuid, replay_response jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wallet public.wallet%rowtype;
  v_policy public.api_cost_policy%rowtype;
  v_existing public.search_requests%rowtype;
  v_now timestamptz := clock_timestamp();
  v_balance bigint;
  v_global_daily bigint;
  v_global_monthly bigint;
  v_device_daily bigint;
  v_device_minute bigint;
  v_entitlement_daily bigint;
  v_entitlement_minute bigint;
  v_reservation_id uuid;
begin
  if p_estimated_units is null or p_estimated_units <= 0 then return query select false, 'invalid_cost_estimate'::text, null::uuid, null::jsonb; return; end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 160 then return query select false, 'invalid_idempotency_key'::text, null::uuid, null::jsonb; return; end if;
  if p_request_hash is null or length(p_request_hash) <> 64 then return query select false, 'invalid_request_hash'::text, null::uuid, null::jsonb; return; end if;

  select * into v_wallet from public.wallet where entitlement_hash = p_entitlement_hash for update;
  if not found then return query select false, 'wallet_not_found'::text, null::uuid, null::jsonb; return; end if;
  if v_wallet.status not in ('active', 'grace') then return query select false, 'entitlement_inactive'::text, null::uuid, null::jsonb; return; end if;

  select * into v_existing from public.search_requests
    where entitlement_hash = p_entitlement_hash and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.request_hash <> p_request_hash then return query select false, 'idempotency_conflict'::text, null::uuid, null::jsonb; return;
    elsif v_existing.status = 'succeeded' then return query select false, 'idempotent_replay'::text, v_existing.reservation_id, v_existing.response_payload; return;
    elsif v_existing.status = 'in_progress' then return query select false, 'request_in_progress'::text, v_existing.reservation_id, null::jsonb; return;
    else return query select false, 'previous_attempt_failed'::text, v_existing.reservation_id, null::jsonb; return;
    end if;
  end if;

  select * into v_policy from public.api_cost_policy where service = p_service for update;
  if not found then return query select false, 'service_not_configured'::text, null::uuid, null::jsonb; return; end if;
  if not v_policy.external_calls_enabled then return query select false, 'external_calls_disabled'::text, null::uuid, null::jsonb; return; end if;
  if v_policy.emergency_kill_switch then return query select false, 'kill_switch_active'::text, null::uuid, null::jsonb; return; end if;
  if p_estimated_units > v_policy.max_estimated_units_per_call then return query select false, 'per_call_limit'::text, null::uuid, null::jsonb; return; end if;

  v_balance := public.wallet_available_balance(p_entitlement_hash);
  if v_balance < p_estimated_units then return query select false, 'wallet_quota_exhausted'::text, null::uuid, null::jsonb; return; end if;

  select coalesce(sum(estimated_units), 0) into v_global_daily from public.api_cost_reservations
    where service = p_service and reserved_at >= date_trunc('day', v_now)
      and (status = 'committed' or (status = 'reserved' and expires_at > v_now));
  if v_global_daily + p_estimated_units > v_policy.global_daily_units then return query select false, 'global_daily_limit'::text, null::uuid, null::jsonb; return; end if;

  select coalesce(sum(estimated_units), 0) into v_global_monthly from public.api_cost_reservations
    where service = p_service and reserved_at >= date_trunc('month', v_now)
      and (status = 'committed' or (status = 'reserved' and expires_at > v_now));
  if v_global_monthly + p_estimated_units > v_policy.global_monthly_units then return query select false, 'global_monthly_limit'::text, null::uuid, null::jsonb; return; end if;

  select coalesce(sum(estimated_units), 0) into v_device_daily from public.api_cost_reservations
    where service = p_service and device_id = p_device_id and reserved_at >= date_trunc('day', v_now)
      and (status = 'committed' or (status = 'reserved' and expires_at > v_now));
  if v_device_daily + p_estimated_units > v_policy.per_device_daily_units then return query select false, 'device_daily_limit'::text, null::uuid, null::jsonb; return; end if;

  select count(*) into v_device_minute from public.api_cost_reservations
    where service = p_service and device_id = p_device_id and reserved_at >= v_now - interval '1 minute'
      and (status = 'committed' or (status = 'reserved' and expires_at > v_now));
  if v_device_minute >= v_policy.max_requests_per_minute_per_device then return query select false, 'device_rate_limit'::text, null::uuid, null::jsonb; return; end if;

  select coalesce(sum(estimated_units), 0) into v_entitlement_daily from public.api_cost_reservations
    where service = p_service and entitlement_hash = p_entitlement_hash and reserved_at >= date_trunc('day', v_now)
      and (status = 'committed' or (status = 'reserved' and expires_at > v_now));
  if v_entitlement_daily + p_estimated_units > v_policy.per_entitlement_daily_units then return query select false, 'entitlement_daily_limit'::text, null::uuid, null::jsonb; return; end if;

  select count(*) into v_entitlement_minute from public.api_cost_reservations
    where service = p_service and entitlement_hash = p_entitlement_hash and reserved_at >= v_now - interval '1 minute'
      and (status = 'committed' or (status = 'reserved' and expires_at > v_now));
  if v_entitlement_minute >= v_policy.max_requests_per_minute_per_entitlement then return query select false, 'entitlement_rate_limit'::text, null::uuid, null::jsonb; return; end if;

  insert into public.api_cost_reservations (device_id, service, estimated_units, reserved_at, expires_at, entitlement_hash, idempotency_key)
  values (p_device_id, p_service, p_estimated_units, v_now, v_now + interval '5 minutes', p_entitlement_hash, p_idempotency_key)
  returning id into v_reservation_id;

  insert into public.wallet_entries (entitlement_hash, kind, units, reservation_id)
    values (p_entitlement_hash, 'reservation', -p_estimated_units, v_reservation_id);
  insert into public.search_requests (entitlement_hash, idempotency_key, device_id, request_hash, reservation_id)
    values (p_entitlement_hash, p_idempotency_key, p_device_id, p_request_hash, v_reservation_id);

  return query select true, 'reserved'::text, v_reservation_id, null::jsonb;
end;
$$;

create or replace function public.finish_wallet_api_cost_reservation(
  p_reservation_id uuid,
  p_outcome text,
  p_actual_units integer,
  p_response_payload jsonb default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.api_cost_reservations%rowtype;
  v_remaining integer;
  v_available bigint;
  v_take integer;
  v_credit record;
begin
  if p_outcome not in ('succeeded', 'failed', 'released') then return false; end if;
  select * into v_reservation from public.api_cost_reservations
    where id = p_reservation_id and status = 'reserved' for update;
  if not found or v_reservation.entitlement_hash is null then return false; end if;
  perform 1 from public.wallet where entitlement_hash = v_reservation.entitlement_hash for update;

  if p_outcome = 'released' then
    if coalesce(p_actual_units, 0) <> 0 then return false; end if;
    update public.api_cost_reservations set status = 'released', finished_at = clock_timestamp()
      where id = p_reservation_id and status = 'reserved';
    insert into public.wallet_entries (entitlement_hash, kind, units, reservation_id)
      values (v_reservation.entitlement_hash, 'reservation_release', v_reservation.estimated_units, p_reservation_id);
  else
    if p_actual_units is null or p_actual_units <= 0 or p_actual_units > v_reservation.estimated_units then return false; end if;

    insert into public.wallet_entries (entitlement_hash, kind, units, reservation_id)
      values (v_reservation.entitlement_hash, 'reservation_release', v_reservation.estimated_units, p_reservation_id);

    v_remaining := p_actual_units;
    for v_credit in
      select c.id, c.units,
             c.units - coalesce((select sum(-u.units) from public.wallet_entries u where u.funding_entry_id = c.id and u.kind = 'usage_commit'), 0) as remaining
      from public.wallet_entries c
      where c.entitlement_hash = v_reservation.entitlement_hash
        and c.kind in ('included_allocation', 'topup_purchase')
        and (c.expires_at is null or c.expires_at > v_reservation.reserved_at)
      order by c.expires_at asc nulls last, c.created_at asc
      for update
    loop
      exit when v_remaining <= 0;
      v_available := greatest(v_credit.remaining, 0);
      if v_available > 0 then
        v_take := least(v_remaining, v_available::integer);
        insert into public.wallet_entries (entitlement_hash, kind, units, reservation_id, funding_entry_id)
          values (v_reservation.entitlement_hash, 'usage_commit', -v_take, p_reservation_id, v_credit.id);
        v_remaining := v_remaining - v_take;
      end if;
    end loop;
    if v_remaining <> 0 then raise exception 'wallet funding invariant violated'; end if;

    update public.api_cost_reservations
      set estimated_units = p_actual_units, status = 'committed', finished_at = clock_timestamp()
      where id = p_reservation_id and status = 'reserved';
  end if;

  update public.search_requests
  set status = case when p_outcome = 'succeeded' then 'succeeded' else 'failed' end,
      response_payload = case when p_outcome = 'succeeded' then p_response_payload else null end,
      error_code = p_error_code,
      finished_at = clock_timestamp()
  where reservation_id = p_reservation_id and status = 'in_progress';
  return true;
end;
$$;

create or replace function public.credit_verified_topup(
  p_entitlement_hash text,
  p_platform text,
  p_product_id text,
  p_transaction_hash text
)
returns table (credited boolean, units integer, balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_units integer;
  v_inserted integer;
begin
  perform 1 from public.wallet where entitlement_hash = p_entitlement_hash for update;
  if not found then return query select false, 0, 0::bigint; return; end if;

  select topup_units into v_units from public.wallet_topup_policy
    where platform = p_platform and product_id = p_product_id and enabled = true;
  if coalesce(v_units, 0) <= 0 then return query select false, 0, public.wallet_available_balance(p_entitlement_hash); return; end if;

  insert into public.wallet_entries (entitlement_hash, kind, units, idempotency_key)
  values (p_entitlement_hash, 'topup_purchase', v_units, p_transaction_hash)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return query select v_inserted = 1, v_units, public.wallet_available_balance(p_entitlement_hash);
end;
$$;

revoke all on function public.upsert_verified_entitlement(text,text,text,text,text,timestamptz,timestamptz,text) from public, anon, authenticated;
revoke all on function public.create_entitlement_session(text,text,text,integer) from public, anon, authenticated;
revoke all on function public.resolve_entitlement_session(text) from public, anon, authenticated;
revoke all on function public.reserve_wallet_api_cost(text,text,text,integer,text,text) from public, anon, authenticated;
revoke all on function public.finish_wallet_api_cost_reservation(uuid,text,integer,jsonb,text) from public, anon, authenticated;
revoke all on function public.credit_verified_topup(text,text,text,text) from public, anon, authenticated;

grant execute on function public.upsert_verified_entitlement(text,text,text,text,text,timestamptz,timestamptz,text) to service_role;
grant execute on function public.create_entitlement_session(text,text,text,integer) to service_role;
grant execute on function public.resolve_entitlement_session(text) to service_role;
grant execute on function public.reserve_wallet_api_cost(text,text,text,integer,text,text) to service_role;
grant execute on function public.finish_wallet_api_cost_reservation(uuid,text,integer,jsonb,text) to service_role;
grant execute on function public.credit_verified_topup(text,text,text,text) to service_role;

comment on table public.wallet is 'Pseudonymous subscription wallet keyed by a server-side HMAC of a verified store entitlement.';
comment on table public.wallet_entries is 'Append-only wallet ledger. Credits fund usage commits; included credits expire at billing-period end and top-up credits persist until consumed.';
comment on table public.search_requests is 'Race-safe idempotency ledger for logical NearTime searches.';
