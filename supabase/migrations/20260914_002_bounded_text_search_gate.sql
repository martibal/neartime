-- Upgrade the live search cost gate for bounded, paginated Text Search (New).
-- The new service remains fail-closed by default. A NearTime search reserves
-- capacity for at most three billable provider calls before the first call.

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
  'places-text-search-enterprise-atmosphere',
  false,
  true,
  0,
  0,
  0,
  0,
  0
)
on conflict (service) do nothing;

-- Retire the previous single-page Nearby Search policy path conservatively.
update public.api_cost_policy
set external_calls_enabled = false,
    emergency_kill_switch = true,
    max_estimated_units_per_call = 0,
    global_daily_units = 0,
    global_monthly_units = 0,
    per_device_daily_units = 0,
    max_requests_per_minute_per_device = 0,
    updated_at = now()
where service = 'places-nearby-enterprise-atmosphere';

create or replace function public.finish_api_cost_reservation_v2(
  p_reservation_id uuid,
  p_status text,
  p_actual_units integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved_units integer;
  v_updated integer;
begin
  if p_status not in ('committed', 'released') then
    return false;
  end if;

  select estimated_units into v_reserved_units
  from public.api_cost_reservations
  where id = p_reservation_id
    and status = 'reserved'
  for update;

  if not found then
    return false;
  end if;

  if p_status = 'released' then
    if coalesce(p_actual_units, 0) <> 0 then
      return false;
    end if;

    update public.api_cost_reservations
    set status = 'released',
        finished_at = clock_timestamp()
    where id = p_reservation_id
      and status = 'reserved';
  else
    if p_actual_units is null or p_actual_units <= 0 or p_actual_units > v_reserved_units then
      return false;
    end if;

    update public.api_cost_reservations
    set estimated_units = p_actual_units,
        status = 'committed',
        finished_at = clock_timestamp()
    where id = p_reservation_id
      and status = 'reserved';
  end if;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.finish_api_cost_reservation_v2(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.finish_api_cost_reservation_v2(uuid, text, integer) to service_role;

comment on function public.finish_api_cost_reservation_v2(uuid, text, integer) is
  'Commits actual billable units up to the amount pre-reserved, or releases an unused reservation. This lets NearTime reserve the maximum search cost before provider calls while recording only actual successful provider calls afterward.';
