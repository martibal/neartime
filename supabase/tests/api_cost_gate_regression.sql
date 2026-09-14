-- Transactional regression suite for the authoritative API cost gate.
-- Safe to run against the NearTime Supabase project: every mutation is rolled back.
-- This intentionally exercises the deployed SQL functions without making any
-- external Google API calls.

begin;

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
  'test-cost-gate-regression',
  false,
  true,
  3,
  6,
  12,
  6,
  2
);

do $$
declare
  r record;
begin
  select * into r from public.reserve_api_cost('device-a', 'test-cost-gate-regression', 1);
  if r.allowed or r.reason <> 'external_calls_disabled' then
    raise exception 'expected external_calls_disabled, got allowed=% reason=%', r.allowed, r.reason;
  end if;
end;
$$;

update public.api_cost_policy
set external_calls_enabled = true
where service = 'test-cost-gate-regression';

do $$
declare
  r record;
begin
  select * into r from public.reserve_api_cost('device-a', 'test-cost-gate-regression', 1);
  if r.allowed or r.reason <> 'kill_switch_active' then
    raise exception 'expected kill_switch_active, got allowed=% reason=%', r.allowed, r.reason;
  end if;
end;
$$;

update public.api_cost_policy
set emergency_kill_switch = false
where service = 'test-cost-gate-regression';

do $$
declare
  r record;
begin
  select * into r from public.reserve_api_cost('device-a', 'test-cost-gate-regression', 4);
  if r.allowed or r.reason <> 'per_call_limit' then
    raise exception 'expected per_call_limit, got allowed=% reason=%', r.allowed, r.reason;
  end if;
end;
$$;

do $$
declare
  r record;
  ok boolean;
  stored_units integer;
  stored_status text;
begin
  select * into r from public.reserve_api_cost('device-a', 'test-cost-gate-regression', 3);
  if not r.allowed or r.reason <> 'reserved' or r.reservation_id is null then
    raise exception 'expected first reservation to succeed';
  end if;

  select public.finish_api_cost_reservation_v2(r.reservation_id, 'committed', 1) into ok;
  if not ok then
    raise exception 'expected v2 commit to succeed';
  end if;

  select estimated_units, status into stored_units, stored_status
  from public.api_cost_reservations where id = r.reservation_id;

  if stored_units <> 1 or stored_status <> 'committed' then
    raise exception 'expected actual units=1 committed, got units=% status=%', stored_units, stored_status;
  end if;
end;
$$;

do $$
declare
  r record;
  ok boolean;
begin
  select * into r from public.reserve_api_cost('device-b', 'test-cost-gate-regression', 3);
  if not r.allowed then
    raise exception 'expected releasable reservation to succeed, got %', r.reason;
  end if;

  select public.finish_api_cost_reservation_v2(r.reservation_id, 'released', 0) into ok;
  if not ok then
    raise exception 'expected release to succeed';
  end if;

  select public.finish_api_cost_reservation_v2(r.reservation_id, 'committed', 1) into ok;
  if ok then
    raise exception 'finished reservation must not be finishable twice';
  end if;
end;
$$;

-- Rate limit: two active/committed requests per minute are allowed, the third is denied.
do $$
declare
  r1 record;
  r2 record;
  r3 record;
begin
  select * into r1 from public.reserve_api_cost('device-rate', 'test-cost-gate-regression', 1);
  select * into r2 from public.reserve_api_cost('device-rate', 'test-cost-gate-regression', 1);
  select * into r3 from public.reserve_api_cost('device-rate', 'test-cost-gate-regression', 1);

  if not r1.allowed or not r2.allowed then
    raise exception 'expected first two rate-limit reservations to succeed';
  end if;
  if r3.allowed or r3.reason <> 'device_rate_limit' then
    raise exception 'expected device_rate_limit on third request, got allowed=% reason=%', r3.allowed, r3.reason;
  end if;
end;
$$;

-- Device daily cap: committed/reserved units count, released units do not.
update public.api_cost_policy
set max_requests_per_minute_per_device = 100,
    global_daily_units = 100,
    global_monthly_units = 100,
    per_device_daily_units = 4
where service = 'test-cost-gate-regression';

do $$
declare
  r1 record;
  r2 record;
begin
  select * into r1 from public.reserve_api_cost('device-daily', 'test-cost-gate-regression', 3);
  select * into r2 from public.reserve_api_cost('device-daily', 'test-cost-gate-regression', 2);

  if not r1.allowed then
    raise exception 'expected first device-daily reservation to succeed';
  end if;
  if r2.allowed or r2.reason <> 'device_daily_limit' then
    raise exception 'expected device_daily_limit, got allowed=% reason=%', r2.allowed, r2.reason;
  end if;
end;
$$;

-- Global daily cap across devices.
update public.api_cost_policy
set per_device_daily_units = 100,
    global_daily_units = 4,
    global_monthly_units = 100
where service = 'test-cost-gate-regression';

do $$
declare
  r1 record;
  r2 record;
begin
  -- Existing committed/reserved test units already count, so isolate by expiring
  -- every still-reserved row and releasing committed accounting via a fresh service window.
  update public.api_cost_reservations
  set expires_at = clock_timestamp() - interval '1 second'
  where service = 'test-cost-gate-regression' and status = 'reserved';

  delete from public.api_cost_reservations
  where service = 'test-cost-gate-regression' and status = 'committed';

  select * into r1 from public.reserve_api_cost('global-a', 'test-cost-gate-regression', 3);
  select * into r2 from public.reserve_api_cost('global-b', 'test-cost-gate-regression', 2);

  if not r1.allowed then
    raise exception 'expected first global reservation to succeed';
  end if;
  if r2.allowed or r2.reason <> 'global_daily_limit' then
    raise exception 'expected global_daily_limit, got allowed=% reason=%', r2.allowed, r2.reason;
  end if;
end;
$$;

-- Invalid inputs must fail closed without creating reservations.
do $$
declare
  r record;
begin
  select * into r from public.reserve_api_cost('', 'test-cost-gate-regression', 1);
  if r.allowed or r.reason <> 'invalid_device_id' then
    raise exception 'expected invalid_device_id';
  end if;

  select * into r from public.reserve_api_cost('device-x', 'test-cost-gate-regression', 0);
  if r.allowed or r.reason <> 'invalid_cost_estimate' then
    raise exception 'expected invalid_cost_estimate';
  end if;

  select * into r from public.reserve_api_cost('device-x', 'missing-test-service', 1);
  if r.allowed or r.reason <> 'service_not_configured' then
    raise exception 'expected service_not_configured';
  end if;
end;
$$;

rollback;
