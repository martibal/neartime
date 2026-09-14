-- NearTime launch funnel analytics.
-- Privacy-minimal: no raw GPS, address, query text, place names, email, or account identity.
-- Server-side events are keyed only by a one-way installation hash and purchase lineage hashes.

create table if not exists public.purchase_funnel_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (event_name in (
    'trial_started',
    'trial_search_success',
    'trial_exhausted',
    'purchase_completed',
    'first_purchase_sku',
    'repurchase_sku',
    'days_since_first_purchase',
    'trip_to_monthly_conversion'
  )),
  install_hash text not null check (length(install_hash) = 64),
  event_key text not null check (length(event_key) between 8 and 200),
  sku text,
  prior_sku text,
  purchase_sequence integer check (purchase_sequence is null or purchase_sequence > 0),
  successful_trial_search_number integer check (
    successful_trial_search_number is null or successful_trial_search_number between 1 and 3
  ),
  exhaustion_reason text check (
    exhaustion_reason is null or exhaustion_reason in ('success_limit', 'attempt_limit')
  ),
  days_since_first_purchase numeric check (
    days_since_first_purchase is null or days_since_first_purchase >= 0
  ),
  activated_at timestamptz,
  expires_at timestamptz,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (install_hash, event_key)
);

create index if not exists purchase_funnel_events_name_time_idx
  on public.purchase_funnel_events (event_name, occurred_at desc);

create index if not exists purchase_funnel_events_install_time_idx
  on public.purchase_funnel_events (install_hash, occurred_at asc);

alter table public.purchase_funnel_events enable row level security;
revoke all on public.purchase_funnel_events from public, anon, authenticated;
grant select, insert on public.purchase_funnel_events to service_role;

create or replace function public.record_purchase_funnel_event(
  p_event_name text,
  p_install_hash text,
  p_event_key text,
  p_sku text default null,
  p_prior_sku text default null,
  p_purchase_sequence integer default null,
  p_successful_trial_search_number integer default null,
  p_exhaustion_reason text default null,
  p_days_since_first_purchase numeric default null,
  p_activated_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_occurred_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_name not in (
    'trial_started',
    'trial_search_success',
    'trial_exhausted',
    'purchase_completed',
    'first_purchase_sku',
    'repurchase_sku',
    'days_since_first_purchase',
    'trip_to_monthly_conversion'
  ) then
    raise exception 'invalid funnel event';
  end if;

  if p_install_hash is null or length(p_install_hash) <> 64 then
    raise exception 'invalid install hash';
  end if;

  if p_event_key is null or length(p_event_key) < 8 or length(p_event_key) > 200 then
    raise exception 'invalid event key';
  end if;

  insert into public.purchase_funnel_events (
    event_name,
    install_hash,
    event_key,
    sku,
    prior_sku,
    purchase_sequence,
    successful_trial_search_number,
    exhaustion_reason,
    days_since_first_purchase,
    activated_at,
    expires_at,
    occurred_at
  ) values (
    p_event_name,
    p_install_hash,
    p_event_key,
    nullif(trim(p_sku), ''),
    nullif(trim(p_prior_sku), ''),
    p_purchase_sequence,
    p_successful_trial_search_number,
    p_exhaustion_reason,
    p_days_since_first_purchase,
    p_activated_at,
    p_expires_at,
    coalesce(p_occurred_at, now())
  )
  on conflict (install_hash, event_key) do nothing;

  return true;
end;
$$;

revoke all on function public.record_purchase_funnel_event(
  text, text, text, text, text, integer, integer, text, numeric, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_purchase_funnel_event(
  text, text, text, text, text, integer, integer, text, numeric, timestamptz, timestamptz, timestamptz
) to service_role;

-- Aggregate funnel view. Installation hashes remain available only to service-role code;
-- this view is intended for internal aggregate analysis, not client access.
create or replace view public.purchase_funnel_summary
with (security_invoker = true)
as
select
  count(distinct install_hash) filter (where event_name = 'trial_started') as trial_starts,
  count(distinct install_hash) filter (where event_name = 'trial_exhausted') as trial_exhausted,
  count(distinct install_hash) filter (where event_name = 'first_purchase_sku') as first_purchasers,
  case
    when count(distinct install_hash) filter (where event_name = 'trial_started') = 0 then 0::numeric
    else round(
      count(distinct install_hash) filter (where event_name = 'first_purchase_sku')::numeric
      / count(distinct install_hash) filter (where event_name = 'trial_started')::numeric * 100,
      2
    )
  end as trial_to_paid_pct,
  count(*) filter (where event_name = 'repurchase_sku') as repurchases,
  count(*) filter (where event_name = 'trip_to_monthly_conversion') as trip_to_monthly_conversions
from public.purchase_funnel_events;

revoke all on public.purchase_funnel_summary from public, anon, authenticated;
grant select on public.purchase_funnel_summary to service_role;
