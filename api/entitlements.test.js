const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sha256Hex,
  appleStatusToWallet,
  googleWalletStatus,
} = require('./lib/entitlements');

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
