const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sha256Hex,
  appleStatusToWallet,
  googleWalletStatus,
} = require('./lib/entitlements');
const {
  tripPassDurationDays,
  tripPassWindow,
  tripPassStatus,
} = require('./lib/tripPass');

test('sha256Hex is deterministic and does not expose its input', () => {
  const first = sha256Hex('purchase-token-example');
  const second = sha256Hex('purchase-token-example');
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.notEqual(first, 'purchase-token-example');
});

test('Apple entitlement mapping grants only active or explicit grace states', () => {
  assert.equal(appleStatusToWallet(1, {}), 'active');
  assert.equal(appleStatusToWallet(4, {}), 'grace');
  assert.equal(appleStatusToWallet(3, {}), 'expired');
  assert.equal(appleStatusToWallet(2, {}), 'expired');
  assert.equal(appleStatusToWallet(1, { revocationDate: Date.now() }), 'refunded');
});

test('Google entitlement mapping is fail-closed but preserves paid time after cancellation', () => {
  const future = Date.now() + 60_000;
  const past = Date.now() - 60_000;
  assert.equal(googleWalletStatus({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }, future), 'active');
  assert.equal(googleWalletStatus({ subscriptionState: 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD' }, future), 'grace');
  assert.equal(googleWalletStatus({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, future), 'active');
  assert.equal(googleWalletStatus({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED' }, past), 'expired');
  assert.equal(googleWalletStatus({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD' }, future), 'expired');
});

test('Trip Pass duration policy is fixed server-side and rejects unknown products', () => {
  assert.equal(tripPassDurationDays('neartime_trip_3d'), 3);
  assert.equal(tripPassDurationDays('neartime_trip_7d'), 7);
  assert.equal(tripPassDurationDays('neartime_monthly'), null);
  assert.equal(tripPassDurationDays('unknown'), null);
});

test('Trip Pass window starts at verified store purchase time', () => {
  const purchaseMs = Date.parse('2026-09-14T12:00:00Z');
  const threeDay = tripPassWindow('neartime_trip_3d', purchaseMs);
  const sevenDay = tripPassWindow('neartime_trip_7d', purchaseMs);
  assert.equal(threeDay.billingPeriodStart, '2026-09-14T12:00:00.000Z');
  assert.equal(threeDay.billingPeriodEnd, '2026-09-17T12:00:00.000Z');
  assert.equal(sevenDay.billingPeriodEnd, '2026-09-21T12:00:00.000Z');
});

test('Trip Pass status fails closed for pending, revoked and expired purchases', () => {
  const purchaseMs = Date.parse('2026-09-14T12:00:00Z');
  const duringPass = Date.parse('2026-09-15T12:00:00Z');
  const afterPass = Date.parse('2026-09-18T12:00:00Z');
  assert.equal(tripPassStatus({ purchaseMs, productId: 'neartime_trip_3d', nowMs: duringPass }), 'active');
  assert.equal(tripPassStatus({ purchaseMs, productId: 'neartime_trip_3d', purchased: false, nowMs: duringPass }), 'expired');
  assert.equal(tripPassStatus({ purchaseMs, productId: 'neartime_trip_3d', revoked: true, nowMs: duringPass }), 'refunded');
  assert.equal(tripPassStatus({ purchaseMs, productId: 'neartime_trip_3d', nowMs: afterPass }), 'expired');
});
