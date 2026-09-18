-- Make the Cost Monitor's free-tier counters live and exact for the active NearTime paths.

create or replace function public.neartime_record_client_quota_usage(
  p_service text,
  p_units integer default 1,
  p_event_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text := lower(trim(coalesce(p_service, '')));
  v_key text;
begin
  if v_service not in ('tomtom_places_suggest', 'tomtom_places_details') then
    raise exception 'INVALID_CLIENT_QUOTA_SERVICE';
  end if;

  if coalesce(p_units, 0) < 1 or p_units > 100 then
    raise exception 'INVALID_PROVIDER_UNITS';
  end if;

  if p_event_id is not null then
    v_key := 'client:' || v_service || ':' || p_event_id::text;
  end if;

  insert into public.neartime_provider_quota_usage (
    provider, service, units, request_id, build_id, dedupe_key
  )
  values (
    'tomtom', v_service, p_units, p_event_id, 'android-client', v_key
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

revoke all on function public.neartime_record_client_quota_usage(text,integer,uuid) from public;
grant execute on function public.neartime_record_client_quota_usage(text,integer,uuid)
  to anon, authenticated, service_role;

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
first_google_ledger as (
  select min(l.occurred_at) as first_at
  from public.neartime_search_cost_ledger l
  cross join month_bounds b
  where l.occurred_at >= b.start_at
    and l.occurred_at < b.end_at
    and lower(coalesce(l.build_id,'')) like '%google%'
),
usage_exact as (
  select 'google_nearby_enterprise_atmosphere'::text as service,
         (
           select count(*)::bigint
           from public.neartime_search_cost_ledger l
           cross join month_bounds b
           where l.occurred_at >= b.start_at
             and l.occurred_at < b.end_at
             and lower(coalesce(l.build_id,'')) like '%google%'
         )
         +
         (
           select coalesce(sum(r.estimated_units),0)::bigint
           from public.api_cost_reservations r
           cross join month_bounds b
           cross join first_google_ledger fg
           where r.reserved_at >= b.start_at
             and r.reserved_at < b.end_at
             and r.status = 'committed'
             and r.cost_bucket = 'search_quota'
             and r.service = 'places-nearby-enterprise-atmosphere'
             and (fg.first_at is null or r.reserved_at < fg.first_at)
         ) as used

  union all

  select 'google_text_search_enterprise_atmosphere',
         (
           select coalesce(sum(r.estimated_units),0)::bigint
           from public.api_cost_reservations r
           cross join month_bounds b
           where r.reserved_at >= b.start_at
             and r.reserved_at < b.end_at
             and r.status = 'committed'
             and r.cost_bucket = 'search_quota'
             and r.service = 'places-text-search-enterprise-atmosphere'
         )

  union all

  select 'tomtom_places_discover',
         (
           select coalesce(sum(l.tomtom_discover_calls),0)::bigint
           from public.neartime_search_cost_ledger l
           cross join month_bounds b
           where l.occurred_at >= b.start_at
             and l.occurred_at < b.end_at
         )

  union all

  select 'tomtom_routing',
         (
           select coalesce(sum(l.tomtom_route_calls),0)::bigint
           from public.neartime_search_cost_ledger l
           cross join month_bounds b
           where l.occurred_at >= b.start_at
             and l.occurred_at < b.end_at
         )

  union all

  select 'tomtom_places_suggest',
         (
           select coalesce(sum(u.units),0)::bigint
           from public.neartime_provider_quota_usage u
           cross join month_bounds b
           where u.occurred_at >= b.start_at
             and u.occurred_at < b.end_at
             and u.service = 'tomtom_places_suggest'
             and u.dedupe_key like 'client:%'
         )

  union all

  select 'tomtom_places_details',
         (
           select coalesce(sum(u.units),0)::bigint
           from public.neartime_provider_quota_usage u
           cross join month_bounds b
           where u.occurred_at >= b.start_at
             and u.occurred_at < b.end_at
             and u.service = 'tomtom_places_details'
             and u.dedupe_key like 'client:%'
         )
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
  left join usage_exact u on u.service = q.service
)
select jsonb_build_object(
  'today', to_jsonb(today),
  'recent', recent.rows,
  'free_quotas', quotas.rows,
  'quota_period', to_char((select start_at from month_bounds), 'YYYY-MM'),
  'quota_note', 'Suggest/Details counters are exact from tracker activation; earlier calls were not persisted.'
)
from today cross join recent cross join quotas;
$$;

revoke all on function public.neartime_cost_monitor(integer) from public;
grant execute on function public.neartime_cost_monitor(integer)
  to anon, authenticated, service_role;
