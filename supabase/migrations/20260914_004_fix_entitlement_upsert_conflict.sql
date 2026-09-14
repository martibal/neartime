-- Fix PL/pgSQL output-column ambiguity in the wallet upsert.
create or replace function public.upsert_verified_entitlement(
  p_platform text,
  p_external_id_hash text,
  p_linked_external_id_hash text,
  p_proposed_entitlement_hash text,
  p_product_id text,
  p_billing_period_start timestamptz,
  p_billing_period_end timestamptz,
  p_status text
)
returns table (entitlement_hash text, balance bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entitlement_hash text;
  v_included_units integer := 0;
  v_allocation_key text;
begin
  if p_platform not in ('ios', 'android') or p_status not in ('active', 'grace', 'expired', 'refunded') then
    raise exception 'invalid entitlement state';
  end if;
  if p_external_id_hash is null or p_proposed_entitlement_hash is null then raise exception 'missing entitlement hash'; end if;
  if p_billing_period_start is null or p_billing_period_end is null or p_billing_period_end <= p_billing_period_start then
    raise exception 'invalid billing period';
  end if;

  select ea.entitlement_hash into v_entitlement_hash
    from public.entitlement_aliases ea where ea.external_id_hash = p_external_id_hash;
  if v_entitlement_hash is null and p_linked_external_id_hash is not null then
    select ea.entitlement_hash into v_entitlement_hash
      from public.entitlement_aliases ea where ea.external_id_hash = p_linked_external_id_hash;
  end if;
  v_entitlement_hash := coalesce(v_entitlement_hash, p_proposed_entitlement_hash);

  insert into public.wallet as w (entitlement_hash, platform, product_id, billing_period_start, billing_period_end, status)
  values (v_entitlement_hash, p_platform, p_product_id, p_billing_period_start, p_billing_period_end, p_status)
  on conflict on constraint wallet_pkey do update
  set product_id = excluded.product_id,
      billing_period_start = excluded.billing_period_start,
      billing_period_end = excluded.billing_period_end,
      status = excluded.status,
      updated_at = now();

  insert into public.entitlement_aliases (external_id_hash, entitlement_hash, platform)
  values (p_external_id_hash, v_entitlement_hash, p_platform)
  on conflict (external_id_hash) do update set entitlement_hash = excluded.entitlement_hash;

  if p_linked_external_id_hash is not null then
    insert into public.entitlement_aliases (external_id_hash, entitlement_hash, platform)
    values (p_linked_external_id_hash, v_entitlement_hash, p_platform)
    on conflict (external_id_hash) do update set entitlement_hash = excluded.entitlement_hash;
  end if;

  if p_status in ('active', 'grace') and p_product_id is not null then
    select wpp.included_units into v_included_units
      from public.wallet_plan_policy wpp
      where wpp.platform = p_platform and wpp.product_id = p_product_id and wpp.enabled = true;
    v_included_units := coalesce(v_included_units, 0);
    if v_included_units > 0 then
      v_allocation_key := 'period:' || extract(epoch from p_billing_period_start)::bigint::text || ':' || p_product_id;
      insert into public.wallet_entries (entitlement_hash, kind, units, idempotency_key, expires_at)
      values (v_entitlement_hash, 'included_allocation', v_included_units, v_allocation_key, p_billing_period_end)
      on conflict do nothing;
    end if;
  end if;

  return query select v_entitlement_hash, public.wallet_available_balance(v_entitlement_hash);
end;
$$;

revoke all on function public.upsert_verified_entitlement(text,text,text,text,text,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.upsert_verified_entitlement(text,text,text,text,text,timestamptz,timestamptz,text) to service_role;