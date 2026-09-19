-- Google-aware search cost ledger v2.
-- Production-applied 2026-09-19.

alter table public.neartime_search_cost_ledger
  add column if not exists google_nearby_calls integer not null default 0,
  add column if not exists google_text_calls integer not null default 0,
  add column if not exists google_routing_summary_places integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='neartime_search_cost_ledger_google_nearby_calls_check') then
    alter table public.neartime_search_cost_ledger add constraint neartime_search_cost_ledger_google_nearby_calls_check check (google_nearby_calls >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='neartime_search_cost_ledger_google_text_calls_check') then
    alter table public.neartime_search_cost_ledger add constraint neartime_search_cost_ledger_google_text_calls_check check (google_text_calls >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='neartime_search_cost_ledger_google_routing_summary_places_check') then
    alter table public.neartime_search_cost_ledger add constraint neartime_search_cost_ledger_google_routing_summary_places_check check (google_routing_summary_places >= 0);
  end if;
end $$;

update public.neartime_search_cost_ledger
set google_nearby_calls = 1
where google_nearby_calls = 0
  and google_text_calls = 0
  and tomtom_discover_calls = 0
  and tomtom_route_calls = 0
  and lower(coalesce(build_id,'')) like '%google%';

create or replace function public.neartime_record_search_cost_v2(
  p_request_id uuid,
  p_category text,
  p_max_walk_minutes integer,
  p_open_now_only boolean,
  p_result_status text,
  p_result_count integer,
  p_google_nearby_calls integer,
  p_google_text_calls integer,
  p_google_routing_summary_places integer,
  p_tomtom_discover_calls integer,
  p_tomtom_route_calls integer,
  p_estimated_cost_nok numeric,
  p_cost_cap_nok numeric,
  p_build_id text
)
returns void
language sql
security definer
set search_path = public
as $function$
  insert into public.neartime_search_cost_ledger(
    request_id, category, max_walk_minutes, open_now_only, result_status, result_count,
    google_nearby_calls, google_text_calls, google_routing_summary_places,
    tomtom_discover_calls, tomtom_route_calls, estimated_cost_nok, cost_cap_nok, build_id
  ) values (
    p_request_id, p_category, p_max_walk_minutes, p_open_now_only, p_result_status,
    greatest(coalesce(p_result_count,0),0),
    greatest(coalesce(p_google_nearby_calls,0),0),
    greatest(coalesce(p_google_text_calls,0),0),
    greatest(coalesce(p_google_routing_summary_places,0),0),
    greatest(coalesce(p_tomtom_discover_calls,0),0),
    greatest(coalesce(p_tomtom_route_calls,0),0),
    greatest(coalesce(p_estimated_cost_nok,0),0),
    greatest(coalesce(p_cost_cap_nok,0),0),
    coalesce(nullif(trim(p_build_id),''),'unknown')
  )
  on conflict (request_id) do update set
    result_status=excluded.result_status,
    result_count=excluded.result_count,
    google_nearby_calls=excluded.google_nearby_calls,
    google_text_calls=excluded.google_text_calls,
    google_routing_summary_places=excluded.google_routing_summary_places,
    tomtom_discover_calls=excluded.tomtom_discover_calls,
    tomtom_route_calls=excluded.tomtom_route_calls,
    estimated_cost_nok=excluded.estimated_cost_nok,
    cost_cap_nok=excluded.cost_cap_nok,
    build_id=excluded.build_id;
$function$;

revoke all on function public.neartime_record_search_cost_v2(
  uuid,text,integer,boolean,text,integer,integer,integer,integer,integer,integer,numeric,numeric,text
) from public;
grant execute on function public.neartime_record_search_cost_v2(
  uuid,text,integer,boolean,text,integer,integer,integer,integer,integer,integer,numeric,numeric,text
) to service_role;

-- The production neartime_cost_monitor() RPC is also replaced by this migration
-- to expose google_nearby_calls, google_text_calls and google_routing_summary_places.
-- Keep its full production definition in Supabase migration history; this repository
-- file documents the schema/RPC contract consumed by tools/cost-monitor.
