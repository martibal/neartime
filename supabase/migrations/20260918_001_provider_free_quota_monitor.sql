-- NearTime free-tier quota telemetry for the local Cost Monitor.
-- Tracks provider billable/request events without storing location, query, place, or user data.

create table if not exists public.neartime_provider_quota_usage (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  provider text not null,
  service text not null,
  units integer not null check (units > 0),
  request_id uuid,
  build_id text,
  dedupe_key text unique
);

create index if not exists neartime_provider_quota_usage_month_idx
  on public.neartime_provider_quota_usage (occurred_at, provider, service);

revoke all on table public.neartime_provider_quota_usage from public, anon, authenticated;
grant select, insert on table public.neartime_provider_quota_usage to service_role;
grant usage, select on sequence public.neartime_provider_quota_usage_id_seq to service_role;

create or replace function public.neartime_record_provider_quota_usage(
  p_provider text,
  p_service text,
  p_units integer default 1,
  p_request_id uuid default null,
  p_build_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_service text := lower(trim(coalesce(p_service, '')));
  v_key text;
begin
  if v_provider not in ('google', 'tomtom') then
    raise exception 'INVALID_PROVIDER';
  end if;

  if v_service not in (
    'google_nearby_enterprise_atmosphere',
    'google_text_search_enterprise_atmosphere',
    'tomtom_places_discover',
    'tomtom_routing',
    'tomtom_places_suggest',
    'tomtom_places_details'
  ) then
    raise exception 'INVALID_PROVIDER_SERVICE';
  end if;

  if coalesce(p_units, 0) < 1 or p_units > 10000 then
    raise exception 'INVALID_PROVIDER_UNITS';
  end if;

  if p_request_id is not null then
    v_key := v_provider || ':' || v_service || ':' || p_request_id::text;
  end if;

  insert into public.neartime_provider_quota_usage (
    provider, service, units, request_id, build_id, dedupe_key
  )
  values (
    v_provider, v_service, p_units, p_request_id, nullif(trim(p_build_id), ''), v_key
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function public.neartime_record_provider_quota_usage(text,text,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.neartime_record_provider_quota_usage(text,text,integer,uuid,text)
  to service_role;

-- Backfill exact count-backed usage already generated this month before this tracker existed.
insert into public.neartime_provider_quota_usage (
  occurred_at, provider, service, units, build_id, dedupe_key
)
select
  l.occurred_at,
  'google',
  'google_nearby_enterprise_atmosphere',
  1,
  l.build_id,
  'backfill:search:google:' || l.request_id::text
from public.neartime_search_cost_ledger l
where l.occurred_at >= date_trunc('month', now())
  and lower(coalesce(l.build_id, '')) like '%google%'
on conflict (dedupe_key) do nothing;

insert into public.neartime_provider_quota_usage (
  occurred_at, provider, service, units, build_id, dedupe_key
)
select
  l.occurred_at,
  'tomtom',
  'tomtom_places_discover',
  l.tomtom_discover_calls,
  l.build_id,
  'backfill:search:tomtom-discover:' || l.request_id::text
from public.neartime_search_cost_ledger l
where l.occurred_at >= date_trunc('month', now())
  and l.tomtom_discover_calls > 0
on conflict (dedupe_key) do nothing;

insert into public.neartime_provider_quota_usage (
  occurred_at, provider, service, units, build_id, dedupe_key
)
select
  l.occurred_at,
  'tomtom',
  'tomtom_routing',
  l.tomtom_route_calls,
  l.build_id,
  'backfill:search:tomtom-routing:' || l.request_id::text
from public.neartime_search_cost_ledger l
where l.occurred_at >= date_trunc('month', now())
  and l.tomtom_route_calls > 0
on conflict (dedupe_key) do nothing;

-- Older Google quota-gated probes predate the search-cost ledger.
insert into public.neartime_provider_quota_usage (
  occurred_at, provider, service, units, dedupe_key
)
select
  r.reserved_at,
  'google',
  case r.service
    when 'places-nearby-enterprise-atmosphere'
      then 'google_nearby_enterprise_atmosphere'
    when 'places-text-search-enterprise-atmosphere'
      then 'google_text_search_enterprise_atmosphere'
  end,
  greatest(1, coalesce(r.estimated_units, 1)),
  'backfill:reservation:' || r.id::text
from public.api_cost_reservations r
where r.reserved_at >= date_trunc('month', now())
  and r.status = 'committed'
  and r.cost_bucket = 'search_quota'
  and r.service in (
    'places-nearby-enterprise-atmosphere',
    'places-text-search-enterprise-atmosphere'
  )
on conflict (dedupe_key) do nothing;

create or replace function public.neartime_cost_monitor(p_limit integer default 100)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with month_bounds as (
  select
    date_trunc('month', now()) as start_at,
    date_trunc('month', now()) + interval '1 month' as end_at
),
today as (
  select
    count(*)::int searches,
    coalesce(sum(estimated_cost_nok),0) total_cost_nok,
    coalesce(avg(estimated_cost_nok),0) avg_cost_nok,
    coalesce(max(estimated_cost_nok),0) max_cost_nok,
    coalesce(sum(tomtom_discover_calls),0)::int discover_calls,
    coalesce(sum(tomtom_route_calls),0)::int route_calls
  from public.neartime_search_cost_ledger
  where (occurred_at at time zone 'Europe/Oslo')::date =
        (now() at time zone 'Europe/Oslo')::date
),
recent as (
  select coalesce(jsonb_agg(to_jsonb(x) order by x.occurred_at desc),'[]'::jsonb) rows
  from (
    select request_id, occurred_at, category, max_walk_minutes, open_now_only,
           result_status, result_count, tomtom_discover_calls, tomtom_route_calls,
           estimated_cost_nok, cost_cap_nok, build_id
    from public.neartime_search_cost_ledger
    order by occurred_at desc
    limit greatest(1,least(coalesce(p_limit,100),250))
  ) x
),
quota_def as (
  select * from (values
    (1, 'google_nearby_enterprise_atmosphere', 'Google Nearby E+A', 1000),
    (2, 'google_text_search_enterprise_atmosphere', 'Google Text Search E+A', 1000),
    (3, 'tomtom_places_discover', 'TomTom Discover', 5000),
    (4, 'tomtom_routing', 'TomTom Routing', 20000),
    (5, 'tomtom_places_suggest', 'TomTom Suggest', 10000),
    (6, 'tomtom_places_details', 'TomTom Details', 5000)
  ) q(sort_order, service, label, free_cap)
),
quota_used as (
  select
    u.service,
    coalesce(sum(u.units), 0)::bigint as used
  from public.neartime_provider_quota_usage u
  cross join month_bounds b
  where u.occurred_at >= b.start_at
    and u.occurred_at < b.end_at
  group by u.service
),
quotas as (
  select jsonb_agg(
    jsonb_build_object(
      'service', q.service,
      'label', q.label,
      'used', coalesce(u.used,0),
      'free_cap', q.free_cap,
      'remaining', greatest(q.free_cap::bigint - coalesce(u.used,0), 0),
      'percent_used', round(
        least(100.0, (coalesce(u.used,0)::numeric * 100.0) / q.free_cap::numeric),
        2
      )
    )
    order by q.sort_order
  ) as rows
  from quota_def q
  left join quota_used u on u.service = q.service
)
select jsonb_build_object(
  'today', to_jsonb(today),
  'recent', recent.rows,
  'free_quotas', quotas.rows,
  'quota_period', to_char((select start_at from month_bounds), 'YYYY-MM')
)
from today cross join recent cross join quotas;
$$;

revoke all on function public.neartime_cost_monitor(integer) from public;
grant execute on function public.neartime_cost_monitor(integer) to anon, authenticated, service_role;
