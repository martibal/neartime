-- Privacy-minimal telemetry derived from already persisted successful search responses.
-- No latitude, longitude, address, place name, query text, or raw request body is stored here.
-- The underlying response_payload is already written atomically by the wallet finalization flow.

create or replace view public.search_cost_telemetry
with (security_invoker = true)
as
select
  sr.entitlement_hash,
  sr.reservation_id,
  sr.created_at,
  sr.finished_at,
  nullif(sr.response_payload ->> 'billingSku', '') as billing_sku,
  nullif(sr.response_payload ->> 'provider', '') as provider,
  case
    when (sr.response_payload ->> 'costUnits') ~ '^[0-9]+$'
      then (sr.response_payload ->> 'costUnits')::integer
    else null
  end as provider_calls,
  case
    when (sr.response_payload ->> 'candidateCount') ~ '^[0-9]+$'
      then (sr.response_payload ->> 'candidateCount')::integer
    else null
  end as candidate_count,
  case
    when (sr.response_payload ->> 'qualifiedCount') ~ '^[0-9]+$'
      then (sr.response_payload ->> 'qualifiedCount')::integer
    else null
  end as qualified_count,
  case
    when jsonb_typeof(sr.response_payload -> 'providerResultLimitReached') = 'boolean'
      then (sr.response_payload ->> 'providerResultLimitReached')::boolean
    else null
  end as provider_result_limit_reached,
  nullif(sr.response_payload #>> '{places,0,category}', '') as category,
  case
    when nullif(sr.response_payload #>> '{places,0,walkMinutes}', '') is not null
      and (sr.response_payload #>> '{places,0,walkMinutes}')::numeric < 9999 then 'Walk'
    when nullif(sr.response_payload #>> '{places,0,driveMinutes}', '') is not null
      and (sr.response_payload #>> '{places,0,driveMinutes}')::numeric < 9999 then 'Drive'
    when nullif(sr.response_payload #>> '{places,0,bikeMinutes}', '') is not null
      and (sr.response_payload #>> '{places,0,bikeMinutes}')::numeric < 9999 then 'Bike'
    else null
  end as travel_mode
from public.search_requests sr
where sr.status = 'succeeded'
  and sr.finished_at is not null
  and sr.response_payload is not null;

revoke all on public.search_cost_telemetry from public, anon, authenticated;
grant select on public.search_cost_telemetry to service_role;

create or replace function public.search_cost_distribution(p_days integer default 30)
returns table (
  provider_calls integer,
  searches bigint,
  percentage numeric,
  avg_candidate_count numeric,
  avg_qualified_count numeric,
  result_limit_rate numeric
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select *
    from public.search_cost_telemetry
    where finished_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)))
      and provider_calls between 1 and 3
  ), grouped as (
    select
      provider_calls,
      count(*)::bigint as searches,
      avg(candidate_count)::numeric as avg_candidate_count,
      avg(qualified_count)::numeric as avg_qualified_count,
      avg(case when provider_result_limit_reached then 1.0 else 0.0 end)::numeric as result_limit_rate
    from base
    group by provider_calls
  ), totals as (
    select count(*)::numeric as total_searches from base
  )
  select
    g.provider_calls,
    g.searches,
    case when t.total_searches = 0 then 0
      else round((g.searches::numeric * 100) / t.total_searches, 2)
    end as percentage,
    round(g.avg_candidate_count, 2),
    round(g.avg_qualified_count, 2),
    round(g.result_limit_rate * 100, 2)
  from grouped g
  cross join totals t
  order by g.provider_calls;
$$;

create or replace function public.search_cost_summary(p_days integer default 30)
returns table (
  searches bigint,
  avg_provider_calls numeric,
  p1_searches bigint,
  p2_searches bigint,
  p3_searches bigint,
  result_limit_rate numeric,
  unique_entitlements bigint
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select *
    from public.search_cost_telemetry
    where finished_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)))
      and provider_calls between 1 and 3
  )
  select
    count(*)::bigint,
    round(coalesce(avg(provider_calls), 0)::numeric, 4),
    count(*) filter (where provider_calls = 1)::bigint,
    count(*) filter (where provider_calls = 2)::bigint,
    count(*) filter (where provider_calls = 3)::bigint,
    round(coalesce(avg(case when provider_result_limit_reached then 1.0 else 0.0 end), 0)::numeric * 100, 2),
    count(distinct entitlement_hash)::bigint
  from base;
$$;

revoke all on function public.search_cost_distribution(integer) from public, anon, authenticated;
revoke all on function public.search_cost_summary(integer) from public, anon, authenticated;
grant execute on function public.search_cost_distribution(integer) to service_role;
grant execute on function public.search_cost_summary(integer) to service_role;
