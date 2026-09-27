-- Compatibility shim for WayNear 1.0.23.
-- Authoritative TomTom Suggest/Details quota accounting moved into native-search.
create or replace function public.neartime_record_client_quota_usage(
  p_service text,
  p_units integer default 1,
  p_event_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_service text := lower(trim(coalesce(p_service, '')));
begin
  if v_service not in ('tomtom_places_suggest', 'tomtom_places_details') then
    raise exception 'INVALID_CLIENT_QUOTA_SERVICE';
  end if;
  if coalesce(p_units, 0) <> 1 then
    raise exception 'INVALID_PROVIDER_UNITS';
  end if;
  return;
end;
$$;

revoke all on function public.neartime_record_client_quota_usage(text,integer,uuid) from public;
grant execute on function public.neartime_record_client_quota_usage(text,integer,uuid)
  to anon, authenticated, service_role;
