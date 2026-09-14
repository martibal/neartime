-- Logical NearTime search allowance, intentionally separate from provider-cost units.
-- Free trial: 3 successful searches, max 5 completed attempts. Technical/provider
-- failures do not consume either counter. Paid quotas are product-policy driven.

create table if not exists public.logical_search_trial_policy (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  max_successful_searches integer not null default 3 check (max_successful_searches > 0),
  max_attempts integer not null default 5 check (max_attempts >= max_successful_searches),
  updated_at timestamptz not null default now()
);

insert into public.logical_search_trial_policy (singleton, enabled, max_successful_searches, max_attempts)
values (true, false, 3, 5)
on conflict (singleton) do nothing;

create table if not exists public.logical_search_plan_policy (
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  included_searches integer not null check (included_searches > 0),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (platform, product_id)
);

create table if not exists public.logical_search_trial_state (
  install_hash text primary key check (length(install_hash) = 64),
  attempts integer not null default 0 check (attempts between 0 and 5),
  successful_searches integer not null default 0 check (successful_searches between 0 and 3),
  exhausted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.logical_search_reservations (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('trial', 'paid')),
  subject_key text not null check (length(subject_key) between 20 and 140),
  install_hash text not null check (length(install_hash) = 64),
  entitlement_hash text references public.wallet(entitlement_hash) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 8 and 160),
  request_hash text not null check (length(request_hash) = 64),
  status text not null default 'reserved' check (status in ('reserved', 'consumed', 'released')),
  qualified_result boolean,
  response_payload jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  finalized_at timestamptz,
  unique (subject_key, idempotency_key),
  check ((subject_type = 'paid' and entitlement_hash is not null) or (subject_type = 'trial' and entitlement_hash is null))
);

create index if not exists logical_search_reservations_entitlement_time_idx
  on public.logical_search_reservations (entitlement_hash, created_at desc)
  where entitlement_hash is not null;
create index if not exists logical_search_reservations_install_time_idx
  on public.logical_search_reservations (install_hash, created_at desc);
create unique index if not exists logical_search_one_active_trial_idx
  on public.logical_search_reservations (install_hash)
  where subject_type = 'trial' and status = 'reserved';

alter table public.logical_search_trial_policy enable row level security;
alter table public.logical_search_plan_policy enable row level security;
alter table public.logical_search_trial_state enable row level security;
alter table public.logical_search_reservations enable row level security;
revoke all on public.logical_search_trial_policy from public, anon, authenticated;
revoke all on public.logical_search_plan_policy from public, anon, authenticated;
revoke all on public.logical_search_trial_state from public, anon, authenticated;
revoke all on public.logical_search_reservations from public, anon, authenticated;
grant select, insert, update on public.logical_search_trial_policy to service_role;
grant select, insert, update on public.logical_search_plan_policy to service_role;
grant select, insert, update on public.logical_search_trial_state to service_role;
grant select, insert, update on public.logical_search_reservations to service_role;

create or replace function public.authorize_logical_search(
  p_install_hash text,
  p_entitlement_hash text,
  p_idempotency_key text,
  p_request_hash text
)
returns table (
  allowed boolean,
  reason text,
  access_mode text,
  logical_reservation_id uuid,
  remaining_searches integer,
  remaining_attempts integer,
  replay_response jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject_key text;
  v_existing public.logical_search_reservations%rowtype;
  v_trial public.logical_search_trial_state%rowtype;
  v_trial_policy public.logical_search_trial_policy%rowtype;
  v_wallet public.wallet%rowtype;
  v_plan public.logical_search_plan_policy%rowtype;
  v_used integer := 0;
  v_id uuid;
begin
  if p_install_hash is null or length(p_install_hash) <> 64 then
    return query select false, 'invalid_install_hash', null::text, null::uuid, null::integer, null::integer, null::jsonb; return;
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 160 then
    return query select false, 'invalid_idempotency_key', null::text, null::uuid, null::integer, null::integer, null::jsonb; return;
  end if;
  if p_request_hash is null or length(p_request_hash) <> 64 then
    return query select false, 'invalid_request_hash', null::text, null::uuid, null::integer, null::integer, null::jsonb; return;
  end if;

  if p_entitlement_hash is null then
    select * into v_trial_policy from public.logical_search_trial_policy where singleton = true for update;
    if not found or not v_trial_policy.enabled then
      return query select false, 'trial_disabled', 'trial', null::uuid, 0, 0, null::jsonb; return;
    end if;

    insert into public.logical_search_trial_state (install_hash)
    values (p_install_hash)
    on conflict (install_hash) do nothing;
    select * into v_trial from public.logical_search_trial_state where install_hash = p_install_hash for update;
    v_subject_key := 'trial:' || p_install_hash;

    select * into v_existing from public.logical_search_reservations
      where subject_key = v_subject_key and idempotency_key = p_idempotency_key for update;
    if found then
      if v_existing.request_hash <> p_request_hash then
        return query select false, 'idempotency_conflict', 'trial', v_existing.id,
          greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0),
          greatest(v_trial_policy.max_attempts - v_trial.attempts, 0), null::jsonb; return;
      elsif v_existing.status = 'consumed' then
        return query select false, 'idempotent_replay', 'trial', v_existing.id,
          greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0),
          greatest(v_trial_policy.max_attempts - v_trial.attempts, 0), v_existing.response_payload; return;
      elsif v_existing.status = 'reserved' and v_existing.expires_at > now() then
        return query select false, 'request_in_progress', 'trial', v_existing.id,
          greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0),
          greatest(v_trial_policy.max_attempts - v_trial.attempts, 0), null::jsonb; return;
      else
        return query select false, 'previous_attempt_failed', 'trial', v_existing.id,
          greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0),
          greatest(v_trial_policy.max_attempts - v_trial.attempts, 0), null::jsonb; return;
      end if;
    end if;

    update public.logical_search_reservations set status = 'released', finalized_at = now(), error_code = 'reservation_expired'
      where subject_type = 'trial' and install_hash = p_install_hash and status = 'reserved' and expires_at <= now();

    if exists (select 1 from public.logical_search_reservations where subject_type = 'trial' and install_hash = p_install_hash and status = 'reserved' and expires_at > now()) then
      return query select false, 'request_in_progress', 'trial', null::uuid,
        greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0),
        greatest(v_trial_policy.max_attempts - v_trial.attempts, 0), null::jsonb; return;
    end if;
    if v_trial.successful_searches >= v_trial_policy.max_successful_searches then
      return query select false, 'trial_success_limit', 'trial', null::uuid, 0,
        greatest(v_trial_policy.max_attempts - v_trial.attempts, 0), null::jsonb; return;
    end if;
    if v_trial.attempts >= v_trial_policy.max_attempts then
      return query select false, 'trial_attempt_limit', 'trial', null::uuid,
        greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0), 0, null::jsonb; return;
    end if;

    insert into public.logical_search_reservations (subject_type, subject_key, install_hash, idempotency_key, request_hash)
    values ('trial', v_subject_key, p_install_hash, p_idempotency_key, p_request_hash)
    returning id into v_id;

    perform public.record_purchase_funnel_event('trial_started', p_install_hash, 'trial_started:v1');
    return query select true, 'reserved', 'trial', v_id,
      v_trial_policy.max_successful_searches - v_trial.successful_searches,
      v_trial_policy.max_attempts - v_trial.attempts, null::jsonb;
    return;
  end if;

  select * into v_wallet from public.wallet where entitlement_hash = p_entitlement_hash for update;
  if not found or v_wallet.status not in ('active', 'grace') then
    return query select false, 'entitlement_inactive', 'paid', null::uuid, 0, null::integer, null::jsonb; return;
  end if;
  select * into v_plan from public.logical_search_plan_policy
    where platform = v_wallet.platform and product_id = v_wallet.product_id and enabled = true;
  if not found then
    return query select false, 'logical_plan_not_configured', 'paid', null::uuid, 0, null::integer, null::jsonb; return;
  end if;

  v_subject_key := 'paid:' || p_entitlement_hash;
  select * into v_existing from public.logical_search_reservations
    where subject_key = v_subject_key and idempotency_key = p_idempotency_key for update;
  if found then
    select count(*) into v_used from public.logical_search_reservations
      where entitlement_hash = p_entitlement_hash
        and created_at >= v_wallet.billing_period_start and created_at < v_wallet.billing_period_end
        and (status = 'consumed' or (status = 'reserved' and expires_at > now()));
    if v_existing.request_hash <> p_request_hash then
      return query select false, 'idempotency_conflict', 'paid', v_existing.id, greatest(v_plan.included_searches - v_used, 0), null::integer, null::jsonb; return;
    elsif v_existing.status = 'consumed' then
      return query select false, 'idempotent_replay', 'paid', v_existing.id, greatest(v_plan.included_searches - v_used, 0), null::integer, v_existing.response_payload; return;
    elsif v_existing.status = 'reserved' and v_existing.expires_at > now() then
      return query select false, 'request_in_progress', 'paid', v_existing.id, greatest(v_plan.included_searches - v_used, 0), null::integer, null::jsonb; return;
    else
      return query select false, 'previous_attempt_failed', 'paid', v_existing.id, greatest(v_plan.included_searches - v_used, 0), null::integer, null::jsonb; return;
    end if;
  end if;

  update public.logical_search_reservations set status = 'released', finalized_at = now(), error_code = 'reservation_expired'
    where entitlement_hash = p_entitlement_hash and status = 'reserved' and expires_at <= now();
  select count(*) into v_used from public.logical_search_reservations
    where entitlement_hash = p_entitlement_hash
      and created_at >= v_wallet.billing_period_start and created_at < v_wallet.billing_period_end
      and (status = 'consumed' or (status = 'reserved' and expires_at > now()));
  if v_used >= v_plan.included_searches then
    return query select false, 'paid_search_quota_exhausted', 'paid', null::uuid, 0, null::integer, null::jsonb; return;
  end if;

  insert into public.logical_search_reservations (subject_type, subject_key, install_hash, entitlement_hash, idempotency_key, request_hash)
  values ('paid', v_subject_key, p_install_hash, p_entitlement_hash, p_idempotency_key, p_request_hash)
  returning id into v_id;
  return query select true, 'reserved', 'paid', v_id, v_plan.included_searches - v_used, null::integer, null::jsonb;
end;
$$;

create or replace function public.finish_logical_search(
  p_reservation_id uuid,
  p_outcome text,
  p_qualified_result boolean default false,
  p_response_payload jsonb default null,
  p_error_code text default null
)
returns table (
  finalized boolean,
  access_mode text,
  remaining_searches integer,
  remaining_attempts integer,
  trial_successes integer,
  trial_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_r public.logical_search_reservations%rowtype;
  v_trial public.logical_search_trial_state%rowtype;
  v_trial_policy public.logical_search_trial_policy%rowtype;
  v_wallet public.wallet%rowtype;
  v_plan public.logical_search_plan_policy%rowtype;
  v_used integer := 0;
  v_reason text;
begin
  if p_outcome not in ('succeeded', 'released') then
    return query select false, null::text, null::integer, null::integer, null::integer, null::integer; return;
  end if;
  select * into v_r from public.logical_search_reservations where id = p_reservation_id for update;
  if not found or v_r.status <> 'reserved' then
    return query select false, coalesce(v_r.subject_type, null), null::integer, null::integer, null::integer, null::integer; return;
  end if;

  if p_outcome = 'released' then
    update public.logical_search_reservations set status = 'released', error_code = p_error_code, finalized_at = now() where id = p_reservation_id;
    return query select true, v_r.subject_type, null::integer, null::integer, null::integer, null::integer; return;
  end if;

  update public.logical_search_reservations
  set status = 'consumed', qualified_result = coalesce(p_qualified_result, false), response_payload = p_response_payload, finalized_at = now()
  where id = p_reservation_id;

  if v_r.subject_type = 'trial' then
    select * into v_trial_policy from public.logical_search_trial_policy where singleton = true;
    select * into v_trial from public.logical_search_trial_state where install_hash = v_r.install_hash for update;
    update public.logical_search_trial_state
      set attempts = attempts + 1,
          successful_searches = successful_searches + case when coalesce(p_qualified_result, false) then 1 else 0 end,
          updated_at = now()
      where install_hash = v_r.install_hash
      returning * into v_trial;

    if coalesce(p_qualified_result, false) then
      perform public.record_purchase_funnel_event(
        'trial_search_success', v_r.install_hash, 'trial_success:' || p_reservation_id::text,
        null, null, null, v_trial.successful_searches
      );
    end if;

    if v_trial.successful_searches >= v_trial_policy.max_successful_searches then
      v_reason := 'success_limit';
    elsif v_trial.attempts >= v_trial_policy.max_attempts then
      v_reason := 'attempt_limit';
    end if;
    if v_reason is not null then
      update public.logical_search_trial_state set exhausted_at = coalesce(exhausted_at, now()) where install_hash = v_r.install_hash;
      perform public.record_purchase_funnel_event(
        'trial_exhausted', v_r.install_hash, 'trial_exhausted:v1',
        null, null, null, null, v_reason
      );
    end if;

    return query select true, 'trial',
      greatest(v_trial_policy.max_successful_searches - v_trial.successful_searches, 0),
      greatest(v_trial_policy.max_attempts - v_trial.attempts, 0),
      v_trial.successful_searches, v_trial.attempts;
    return;
  end if;

  select * into v_wallet from public.wallet where entitlement_hash = v_r.entitlement_hash;
  select * into v_plan from public.logical_search_plan_policy
    where platform = v_wallet.platform and product_id = v_wallet.product_id and enabled = true;
  select count(*) into v_used from public.logical_search_reservations
    where entitlement_hash = v_r.entitlement_hash
      and created_at >= v_wallet.billing_period_start and created_at < v_wallet.billing_period_end
      and (status = 'consumed' or (status = 'reserved' and expires_at > now()));
  return query select true, 'paid', greatest(coalesce(v_plan.included_searches, 0) - v_used, 0), null::integer, null::integer, null::integer;
end;
$$;

revoke all on function public.authorize_logical_search(text, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_logical_search(uuid, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.authorize_logical_search(text, text, text, text) to service_role;
grant execute on function public.finish_logical_search(uuid, text, boolean, jsonb, text) to service_role;

comment on table public.logical_search_plan_policy is 'User-visible paid logical-search quota. This is deliberately separate from provider-call funding units.';
comment on table public.logical_search_trial_state is 'Anonymous free-trial counters. Provider/technical failures are released and do not increment attempts or successes.';
