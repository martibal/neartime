'use strict';

function firstRow(payload) {
  return Array.isArray(payload) ? payload[0] : payload;
}

function asPositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`invalid_${name}`);
  return number;
}

function createProviderCogsHooks({ entitlementHash, deviceId, supabaseRpc }) {
  if (!entitlementHash || typeof entitlementHash !== 'string') throw new Error('entitlement_hash_required');
  if (!deviceId || typeof deviceId !== 'string') throw new Error('device_id_required');
  if (typeof supabaseRpc !== 'function') throw new Error('supabase_rpc_required');

  async function beforeProviderCall(step) {
    const skuId = typeof step?.skuId === 'string' ? step.skuId.trim() : '';
    const idempotencyKey = typeof step?.idempotencyKey === 'string' ? step.idempotencyKey.trim() : '';
    const quantity = asPositiveInteger(step?.quantity ?? 1, 'provider_quantity');

    if (!skuId) throw new Error('provider_sku_required');
    if (idempotencyKey.length < 8 || idempotencyKey.length > 160) throw new Error('invalid_provider_idempotency_key');

    const decision = firstRow(await supabaseRpc('reserve_provider_cogs', {
      p_entitlement_hash: entitlementHash,
      p_device_id: deviceId,
      p_sku_id: skuId,
      p_quantity: quantity,
      p_idempotency_key: idempotencyKey,
      p_ttl_seconds: 300,
    }));

    if (!decision || typeof decision.allowed !== 'boolean') {
      throw new Error('invalid_provider_cogs_reservation_decision');
    }

    if (!decision.allowed) {
      const error = new Error(decision.reason || 'provider_cogs_reservation_denied');
      error.code = decision.reason || 'provider_cogs_reservation_denied';
      error.providerCogsDecision = decision;
      throw error;
    }

    if (!decision.reservation_id) throw new Error('provider_cogs_reservation_missing_id');

    return {
      reservationId: decision.reservation_id,
      reservedMicroUsd: decision.reserved_micro_usd ?? null,
      skuPriceValidFrom: decision.sku_price_valid_from ?? null,
      quantity,
      skuId,
    };
  }

  async function afterProviderCall(step) {
    const reservationId = step?.reservation?.reservationId;
    if (!reservationId) throw new Error('provider_cogs_reservation_missing_id');

    const quantity = asPositiveInteger(step?.quantity ?? step?.reservation?.quantity ?? 1, 'provider_quantity');
    const outcome = step?.outcome === 'succeeded' ? 'succeeded' : 'failed';

    const settlement = firstRow(await supabaseRpc('finish_provider_cogs_reservation', {
      p_reservation_id: reservationId,
      p_outcome: outcome,
      // Conservative accounting: once a provider operation was attempted, reserve/settle
      // its full billable quantity even when the provider request failed.
      p_actual_quantity: quantity,
    }));

    if (!settlement || settlement.ok !== true) {
      const reason = settlement?.reason || 'provider_cogs_settlement_failed';
      const error = new Error(reason);
      error.code = reason;
      error.providerCogsSettlement = settlement;
      throw error;
    }

    return settlement;
  }

  return { beforeProviderCall, afterProviderCall };
}

module.exports = { createProviderCogsHooks };
