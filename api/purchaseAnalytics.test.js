const test = require('node:test');
const assert = require('node:assert/strict');

const { sha256Hex } = require('./lib/entitlements');
const {
  installHashForDevice,
  purchaseAnalyticsPayload,
} = require('./lib/purchaseAnalytics');

test('purchase analytics uses the same anonymous install hash namespace as search', () => {
  assert.equal(
    installHashForDevice('device-123'),
    sha256Hex('install:device-123'),
  );
  assert.equal(installHashForDevice(' device-123 '), sha256Hex('install:device-123'));
});

test('purchase analytics payload contains only hashed purchase identity and launch metadata', () => {
  const payload = purchaseAnalyticsPayload('device-123', {
    externalIdHash: 'a'.repeat(64),
    productId: 'neartime_trip_7d',
    billingPeriodStart: '2026-09-14T12:00:00.000Z',
    billingPeriodEnd: '2026-09-21T12:00:00.000Z',
  });

  assert.deepEqual(payload, {
    p_install_hash: sha256Hex('install:device-123'),
    p_purchase_key: 'a'.repeat(64),
    p_sku: 'neartime_trip_7d',
    p_activated_at: '2026-09-14T12:00:00.000Z',
    p_expires_at: '2026-09-21T12:00:00.000Z',
  });
  assert.equal(JSON.stringify(payload).includes('device-123'), false);
});

test('purchase analytics rejects unknown products and unhashed receipt identity', () => {
  assert.throws(() => purchaseAnalyticsPayload('device-123', {
    externalIdHash: 'short',
    productId: 'neartime_trip_7d',
    billingPeriodStart: '2026-09-14T12:00:00.000Z',
    billingPeriodEnd: '2026-09-21T12:00:00.000Z',
  }), /invalid_purchase_key/);

  assert.throws(() => purchaseAnalyticsPayload('device-123', {
    externalIdHash: 'a'.repeat(64),
    productId: 'unknown_sku',
    billingPeriodStart: '2026-09-14T12:00:00.000Z',
    billingPeriodEnd: '2026-09-21T12:00:00.000Z',
  }), /invalid_launch_sku/);
});
