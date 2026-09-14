const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function loadHandler(mocks) {
  const filename = path.join(__dirname, 'search.js');
  const source = fs.readFileSync(filename, 'utf8');
  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = testModule.require.bind(testModule);
  testModule.require = (request) => {
    if (request === './lib/entitlements') return mocks.entitlements;
    return originalRequire(request);
  };
  testModule._compile(source, filename);
  return testModule.exports;
}

function validBody() {
  return {
    query: {
      category: 'Restaurant',
      travelMode: 'Walk',
      maxMinutes: 10,
      minimumRating: 4.3,
      minimumReviews: 100,
      openNow: true,
      openForMinutes: 120,
    },
    origin: { latitude: 59.91, longitude: 10.75 },
  };
}

function makeReq(headers = {}) {
  return { method: 'POST', body: validBody(), headers };
}

function makeRes() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function baseEntitlements(overrides = {}) {
  return {
    requiredEnv: () => 'fake-google-key',
    sha256Hex: () => 'f'.repeat(64),
    supabaseRpc: async () => { throw new Error('unexpected RPC'); },
    resolveEntitlementSession: async () => null,
    ...overrides,
  };
}

const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

test('live search fails closed before any provider call when entitlement session is missing', async () => {
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements() });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
  }), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { error: 'subscription_verification_required' });
  assert.equal(providerCalls, 0);
});

test('invalid or expired entitlement session blocks before reservation and Google', async () => {
  let rpcCalls = 0;
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    resolveEntitlementSession: async () => null,
    supabaseRpc: async () => { rpcCalls += 1; throw new Error('RPC must not be called'); },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
    'x-neartime-entitlement-session': 'expired-token',
  }), res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { error: 'invalid_or_expired_entitlement_session' });
  assert.equal(rpcCalls, 0);
  assert.equal(providerCalls, 0);
});

test('wallet cost gate denial prevents every Google call', async () => {
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    resolveEntitlementSession: async () => ({ entitlementHash: 'entitlement-1' }),
    supabaseRpc: async (name) => {
      assert.equal(name, 'reserve_wallet_api_cost');
      return [{ allowed: false, reason: 'kill_switch_active', reservation_id: null, replay_response: null }];
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
    'x-neartime-entitlement-session': 'session-token',
  }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.reason, 'kill_switch_active');
  assert.equal(providerCalls, 0);
});

test('idempotent replay returns committed response without another Google call', async () => {
  let providerCalls = 0;
  const replay = { places: [{ id: 'cached', name: 'Cached result' }], costUnits: 1 };
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    resolveEntitlementSession: async () => ({ entitlementHash: 'entitlement-1' }),
    supabaseRpc: async () => [{
      allowed: false,
      reason: 'idempotent_replay',
      reservation_id: 'reservation-1',
      replay_response: replay,
    }],
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
    'x-neartime-entitlement-session': 'session-token',
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, replay);
  assert.equal(providerCalls, 0);
});

test('successful live search reserves worst-case units and commits actual provider calls', async () => {
  const rpcCalls = [];
  let providerCalls = 0;
  global.fetch = async () => {
    providerCalls += 1;
    return {
      ok: true,
      async json() {
        return {
          places: [{
            id: 'google-1',
            displayName: { text: 'Test Restaurant' },
            formattedAddress: 'Example street',
            location: { latitude: 59.911, longitude: 10.751 },
            rating: 4.5,
            userRatingCount: 200,
            priceLevel: 'PRICE_LEVEL_MODERATE',
            currentOpeningHours: { openNow: true, nextCloseTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() },
          }],
          routingSummaries: [{ legs: [{ duration: '300s', distanceMeters: 400 }] }],
        };
      },
    };
  };

  const handler = loadHandler({ entitlements: baseEntitlements({
    resolveEntitlementSession: async () => ({ entitlementHash: 'entitlement-1' }),
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'reserve_wallet_api_cost') {
        return [{ allowed: true, reason: 'reserved', reservation_id: 'reservation-1', replay_response: null }];
      }
      if (name === 'finish_wallet_api_cost_reservation') return true;
      throw new Error(`unexpected RPC ${name}`);
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
    'x-neartime-entitlement-session': 'session-token',
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(providerCalls, 1);
  assert.equal(res.payload.costUnits, 1);
  assert.equal(res.payload.places.length, 1);
  assert.equal(rpcCalls[0].name, 'reserve_wallet_api_cost');
  assert.equal(rpcCalls[0].args.p_estimated_units, 3);
  assert.equal(rpcCalls[1].name, 'finish_wallet_api_cost_reservation');
  assert.equal(rpcCalls[1].args.p_outcome, 'succeeded');
  assert.equal(rpcCalls[1].args.p_actual_units, 1);
});
