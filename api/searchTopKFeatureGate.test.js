'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const handler = require('./search-topk');

const {
  canUseDisabledTopKGate,
  LIVE_PROBE_DEVICE_ID,
  LIVE_PROBE_ENTITLEMENT_HASH,
} = handler;

test('disabled Top-K gate only allows the exact bounded live-probe identity', () => {
  assert.equal(canUseDisabledTopKGate({
    deviceId: LIVE_PROBE_DEVICE_ID,
    entitlementHash: LIVE_PROBE_ENTITLEMENT_HASH,
  }), true);

  assert.equal(canUseDisabledTopKGate({
    deviceId: 'ordinary-device',
    entitlementHash: LIVE_PROBE_ENTITLEMENT_HASH,
  }), false);

  assert.equal(canUseDisabledTopKGate({
    deviceId: LIVE_PROBE_DEVICE_ID,
    entitlementHash: 'not-the-probe-entitlement',
  }), false);
});
