'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createProviderCogsHooks } = require('./lib/providerCogsHooks');

function makeHooks(rpcCalls, handlers = {}) {
  return createProviderCogsHooks({
    entitlementHash: 'entitlement-1',
    deviceId: 'device-1',
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (handlers[name]) return handlers[name](args);
      throw new Error(`unexpected RPC ${name}`);
    },
  });
}

test('reserves exact SKU and quantity before a provider call', async () => {
  const calls = [];
  const hooks = makeHooks(calls, {
    reserve_provider_cogs: async () => [{
      allowed: true,
      reason: 'reserved',
      reservation_id: 'reservation-1',
      reserved_micro_usd: 40000,
      sku_price_valid_from: '2026-09-10T00:00:00Z',
    }],
  });

  const reservation = await hooks.beforeProviderCall({
    skuId: 'F20E-7034-0EF7',
    quantity: 1,
    idempotencyKey: 'search-1:nearby:cell-1',
  });

  assert.equal(reservation.reservationId, 'reservation-1');
  assert.equal(reservation.reservedMicroUsd, 40000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'reserve_provider_cogs');
  assert.deepEqual(calls[0].args, {
    p_entitlement_hash: 'entitlement-1',
    p_device_id: 'device-1',
    p_sku_id: 'F20E-7034-0EF7',
    p_quantity: 1,
    p_idempotency_key: 'search-1:nearby:cell-1',
    p_ttl_seconds: 300,
  });
});

test('denied reservation fails before provider execution can proceed', async () => {
  const calls = [];
  const hooks = makeHooks(calls, {
    reserve_provider_cogs: async () => [{ allowed: false, reason: 'provider_budget_exhausted' }],
  });

  await assert.rejects(
    hooks.beforeProviderCall({
      skuId: '546C-66B2-E5A6',
      quantity: 1,
      idempotencyKey: 'search-1:aggregate:root',
    }),
    (error) => error.code === 'provider_budget_exhausted',
  );
  assert.equal(calls.length, 1);
});

test('successful provider attempt settles the same reservation', async () => {
  const calls = [];
  const hooks = makeHooks(calls, {
    finish_provider_cogs_reservation: async () => [{
      ok: true,
      reason: 'committed',
      reservation_id: 'reservation-1',
      reserved_micro_usd: 40000,
      actual_micro_usd: 40000,
      released_micro_usd: 0,
    }],
  });

  const result = await hooks.afterProviderCall({
    skuId: 'F20E-7034-0EF7',
    quantity: 1,
    outcome: 'succeeded',
    reservation: { reservationId: 'reservation-1', quantity: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].name, 'finish_provider_cogs_reservation');
  assert.deepEqual(calls[0].args, {
    p_reservation_id: 'reservation-1',
    p_outcome: 'succeeded',
    p_actual_quantity: 1,
  });
});

test('failed attempted provider call is conservatively settled as billable', async () => {
  const calls = [];
  const hooks = makeHooks(calls, {
    finish_provider_cogs_reservation: async () => [{
      ok: true,
      reason: 'failed_but_billed',
      reservation_id: 'reservation-2',
      actual_micro_usd: 10000,
    }],
  });

  await hooks.afterProviderCall({
    skuId: '546C-66B2-E5A6',
    quantity: 1,
    outcome: 'failed',
    reservation: { reservationId: 'reservation-2', quantity: 1 },
  });

  assert.equal(calls[0].args.p_outcome, 'failed');
  assert.equal(calls[0].args.p_actual_quantity, 1);
});

test('invalid SKU descriptor is rejected before any RPC', async () => {
  const calls = [];
  const hooks = makeHooks(calls);

  await assert.rejects(
    hooks.beforeProviderCall({ quantity: 1, idempotencyKey: 'search-1:step-1' }),
    /provider_sku_required/,
  );
  assert.equal(calls.length, 0);
});
