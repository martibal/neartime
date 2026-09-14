-- Derive purchase funnel events only from server-verified purchases.
-- The caller supplies an already one-way installation hash and a stable,
-- server-derived purchase key. No raw device id or store receipt is persisted.

create or replace function public.record_verified_purchase_funnel(
  p_install_hash text,
  p_purchase_key text,
  p_sku text,
  p_activated_at timestamptz,
  p_expires_at timestamptz
)
returns table (
  purchase_sequence integer,
  first_purchase boolean,
  prior_sku text,
  days_since_first_purchase numeric,
  trip_to_monthly boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence integer;
  v_first record;
  v_prior record;
  v_days numeric;
  v_is_first boolean;
  v_trip_to_monthly boolean := false;
begin
  if p_install_hash is null or length(p_install_hash) <> 64 then
    raise exception 'invalid install hash';
  end if;
  if p_purchase_key is null or length(p_purchase_key) <> 64 then
    raise exception 'invalid purchase key';
  end if;
  if p_sku not in ('neartime_trip_3d', 'neartime_monthly', 'neartime_trip_7d') then
    raise exception 'invalid launch sku';
  end if;
  if p_activated_at is null or p_expires_at is null or p_expires_at <= p_activated_at then
    raise exception 'invalid activation window';
  end if;

  -- Serialize purchase lineage updates per anonymous installation so two
  -- simultaneously verified receipts cannot both become purchase #1.
  perform pg_advisory_xact_lock(hashtext(p_install_hash));

  -- Idempotency: if this verified purchase was already recorded, return the
  -- existing lineage without inserting duplicate events.
  select purchase_sequence, prior_sku, days_since_first_purchase
    into v_sequence, v_prior, v_days
  from public.purchase_funnel_events
  where install_hash = p_install_hash
    and event_key = 'purchase_completed:' || p_purchase_key
    and event_name = 'purchase_completed'
  limit 1;

  if found then
    v_is_first := v_sequence = 1;
    return query select
      v_sequence,
      v_is_first,
      v_prior.sku,
      v_days,
      coalesce(v_prior.sku in ('neartime_trip_3d', 'neartime_trip_7d') and p_sku = 'neartime_monthly', false);
    return;
  end if;

  select e.sku, e.activated_at
    into v_first
  from public.purchase_funnel_events e
  where e.install_hash = p_install_hash
    and e.event_name = 'first_purchase_sku'
  order by e.occurred_at asc, e.created_at asc
  limit 1;

  select e.sku, e.activated_at
    into v_prior
  from public.purchase_funnel_events e
  where e.install_hash = p_install_hash
    and e.event_name in ('first_purchase_sku', 'repurchase_sku')
  order by e.purchase_sequence desc nulls last, e.occurred_at desc, e.created_at desc
  limit 1;

  select count(*)::integer + 1
    into v_sequence
  from public.purchase_funnel_events e
  where e.install_hash = p_install_hash
    and e.event_name = 'purchase_completed';

  v_is_first := v_sequence = 1;
  if not v_is_first and v_first.activated_at is not null then
    v_days := greatest(
      0,
      extract(epoch from (p_activated_at - v_first.activated_at)) / 86400.0
    );
  else
    v_days := null;
  end if;

  v_trip_to_monthly := not v_is_first
    and v_prior.sku in ('neartime_trip_3d', 'neartime_trip_7d')
    and p_sku = 'neartime_monthly';

  perform public.record_purchase_funnel_event(
    'purchase_completed',
    p_install_hash,
    'purchase_completed:' || p_purchase_key,
    p_sku,
    v_prior.sku,
    v_sequence,
    null,
    null,
    v_days,
    p_activated_at,
    p_expires_at,
    p_activated_at
  );

  if v_is_first then
    perform public.record_purchase_funnel_event(
      'first_purchase_sku',
      p_install_hash,
      'first_purchase_sku:' || p_purchase_key,
      p_sku,
      null,
      1,
      null,
      null,
      null,
      p_activated_at,
      p_expires_at,
      p_activated_at
    );
  else
    perform public.record_purchase_funnel_event(
      'repurchase_sku',
      p_install_hash,
      'repurchase_sku:' || p_purchase_key,
      p_sku,
      v_prior.sku,
      v_sequence,
      null,
      null,
      v_days,
      p_activated_at,
      p_expires_at,
      p_activated_at
    );

    perform public.record_purchase_funnel_event(
      'days_since_first_purchase',
      p_install_hash,
      'days_since_first_purchase:' || p_purchase_key,
      p_sku,
      v_prior.sku,
      v_sequence,
      null,
      null,
      v_days,
      p_activated_at,
      p_expires_at,
      p_activated_at
    );

    if v_trip_to_monthly then
      perform public.record_purchase_funnel_event(
        'trip_to_monthly_conversion',
        p_install_hash,
        'trip_to_monthly:' || p_purchase_key,
        p_sku,
        v_prior.sku,
        v_sequence,
        null,
        null,
        v_days,
        p_activated_at,
        p_expires_at,
        p_activated_at
      );
    end if;
  end if;

  return query select v_sequence, v_is_first, v_prior.sku, v_days, v_trip_to_monthly;
end;
$$;

revoke all on function public.record_verified_purchase_funnel(text, text, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_verified_purchase_funnel(text, text, text, timestamptz, timestamptz)
  to service_role;
