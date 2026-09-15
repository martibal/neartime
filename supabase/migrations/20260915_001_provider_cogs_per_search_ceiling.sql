-- Economic Invariant 2: one logical search must never exceed NOK 10
-- in worst-case provider COGS. This gate is evaluated before any provider
-- reservation or provider call.
--
-- USD -> NOK conversion reuses the existing provider_cogs_plan_policy FX
-- assumptions. usd_per_nok is first reduced by the configured FX haircut and
-- then inverted; taking MAX across current policy rows is conservative.

create or replace function public.check_provider_cogs_search_ceiling(p_plan jsonb)
returns table (
  allowed boolean,
  reason text,
  worst_case_micro_usd bigint,
  worst_case_micro_nok bigint,
  max_search_micro_nok bigint,
  conservative_nok_per_usd_micro bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_sku_id text;
  v_quantity integer;
  v_price public.sku_prices%rowtype;
  v_total_micro_usd bigint := 0;
  v_total_micro_nok bigint;
  v_max_search_micro_nok constant bigint := 10000000; -- NOK 10.000000
  v_conservative_nok_per_usd_micro bigint;
begin
  select max(ceil(
    1000000::numeric /
    (p.usd_per_nok::numeric * ((10000 - p.fx_haircut_basis_points)::numeric / 10000::numeric))
  ))::bigint
  into v_conservative_nok_per_usd_micro
  from public.provider_cogs_plan_policy p
  where p.valid_from <= clock_timestamp()
    and p.usd_per_nok > 0
    and p.fx_haircut_basis_points >= 0
    and p.fx_haircut_basis_points < 10000;

  if v_conservative_nok_per_usd_micro is null or v_conservative_nok_per_usd_micro <= 0 then
    return query select false, 'fx_policy_not_configured'::text, 0::bigint, 0::bigint,
      v_max_search_micro_nok, 0::bigint;
    return;
  end if;

  if p_plan is null or jsonb_typeof(p_plan) <> 'array' or jsonb_array_length(p_plan) = 0 then
    return query select false, 'invalid_provider_cost_plan'::text, 0::bigint, 0::bigint,
      v_max_search_micro_nok, v_conservative_nok_per_usd_micro;
    return;
  end if;

  for v_item in select value from jsonb_array_elements(p_plan)
  loop
    v_sku_id := nullif(trim(v_item->>'sku_id'), '');
    begin
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      v_quantity := null;
    end;

    if v_sku_id is null or v_quantity is null or v_quantity <= 0 or v_quantity > 1000 then
      return query select false, 'invalid_provider_cost_plan'::text, v_total_micro_usd, 0::bigint,
        v_max_search_micro_nok, v_conservative_nok_per_usd_micro;
      return;
    end if;

    select * into v_price
    from public.sku_prices
    where sku_id = v_sku_id
      and valid_from <= clock_timestamp()
    order by valid_from desc
    limit 1;

    if not found then
      return query select false, 'sku_price_not_found'::text, v_total_micro_usd, 0::bigint,
        v_max_search_micro_nok, v_conservative_nok_per_usd_micro;
      return;
    end if;

    v_total_micro_usd := v_total_micro_usd + ceil(
      (v_price.price_per_1000_micro_usd::numeric * v_quantity::numeric) / 1000::numeric
    )::bigint;
  end loop;

  v_total_micro_nok := ceil(
    (v_total_micro_usd::numeric * v_conservative_nok_per_usd_micro::numeric) / 1000000::numeric
  )::bigint;

  if v_total_micro_nok > v_max_search_micro_nok then
    return query select false, 'per_search_cost_ceiling_exceeded'::text,
      v_total_micro_usd, v_total_micro_nok, v_max_search_micro_nok, v_conservative_nok_per_usd_micro;
    return;
  end if;

  return query select true, 'within_per_search_cost_ceiling'::text,
    v_total_micro_usd, v_total_micro_nok, v_max_search_micro_nok, v_conservative_nok_per_usd_micro;
end;
$$;

revoke all on function public.check_provider_cogs_search_ceiling(jsonb) from public, anon, authenticated;
grant execute on function public.check_provider_cogs_search_ceiling(jsonb) to service_role;

comment on function public.check_provider_cogs_search_ceiling(jsonb) is
  'Fail-closed Economic Invariant 2 admission gate. Prices use current paid-list SKU data; USD->NOK conversion reuses the most conservative current provider_cogs_plan_policy FX rate after its configured haircut. Rejects worst-case provider COGS above NOK 10 before provider work starts.';
