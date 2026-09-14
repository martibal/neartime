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
    sha256Hex: (value) => Buffer.from(String(value)).toString('hex').slice(0, 64).padEnd(64, 'f'),
    supabaseRpc: async () => { throw new Error('unexpected RPC'); },
    resolveEntitlementSession: async () => null,
    ...overrides,
  };
}

function googleOneResult() {
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
          currentOpeningHours: {
            openNow: true,
            nextCloseTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
          },
        }],
        routingSummaries: [{ legs: [{ duration: '300s', distanceMeters: 400 }] }],
      };
    },
  };
}

const originalFetch = global.fetch;
test.afterEach(() => { global.fetch = originalFetch; });

test('missing device id fails before any ledger or provider call', async () => {
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements() });
  const res = makeRes();

  await handler(makeReq({ 'x-neartime-idempotency-key': 'search-key-0001' }), res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { error: 'invalid_device_id' });
  assert.equal(providerCalls, 0);
});

test('trial logical gate denial blocks before provider-cost reservation and Google', async () => {
  const rpcCalls = [];
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      assert.equal(name, 'authorize_logical_search');
      return [{ allowed: false, reason: 'trial_disabled', access_mode: 'trial', remaining_searches: 0, remaining_attempts: 0 }];
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
  }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'free_trial_unavailable');
  assert.equal(rpcCalls.length, 1);
  assert.equal(providerCalls, 0);
});

test('invalid paid entitlement session blocks before logical and provider-cost gates', async () => {
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

test('paid logical quota denial blocks before provider-cost reservation and Google', async () => {
  const rpcCalls = [];
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    resolveEntitlementSession: async () => ({ entitlementHash: 'entitlement-1' }),
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return [{ allowed: false, reason: 'paid_search_quota_exhausted', access_mode: 'paid', remaining_searches: 0 }];
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
    'x-neartime-entitlement-session': 'session-token',
  }), res);

  assert.equal(res.statusCode, 402);
  assert.equal(res.payload.error, 'usage_quota_exhausted');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'authorize_logical_search');
  assert.equal(providerCalls, 0);
});

test('trial provider-cost denial releases logical reservation without a Google call', async () => {
  const rpcCalls = [];
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'authorize_logical_search') {
        return [{ allowed: true, reason: 'reserved', access_mode: 'trial', logical_reservation_id: 'logical-1', remaining_searches: 3, remaining_attempts: 5 }];
      }
      if (name === 'reserve_api_cost') return [{ allowed: false, reason: 'kill_switch_active', reservation_id: null }];
      if (name === 'finish_logical_search') return [{ finalized: true, access_mode: 'trial' }];
      throw new Error(`unexpected RPC ${name}`);
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
  }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.reason, 'kill_switch_active');
  assert.equal(rpcCalls[1].name, 'reserve_api_cost');
  assert.equal(rpcCalls[2].name, 'finish_logical_search');
  assert.equal(rpcCalls[2].args.p_outcome, 'released');
  assert.equal(providerCalls, 0);
});

test('successful trial search uses company cost gate and consumes one logical success', async () => {
  const rpcCalls = [];
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; return googleOneResult(); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'authorize_logical_search') {
        return [{ allowed: true, reason: 'reserved', access_mode: 'trial', logical_reservation_id: 'logical-1', remaining_searches: 3, remaining_attempts: 5 }];
      }
      if (name === 'reserve_api_cost') return [{ allowed: true, reason: 'reserved', reservation_id: 'cost-1' }];
      if (name === 'finish_api_cost_reservation_v2') return true;
      if (name === 'finish_logical_search') return [{ finalized: true, access_mode: 'trial', remaining_searches: 2, remaining_attempts: 4, trial_successes: 1, trial_attempts: 1 }];
      throw new Error(`unexpected RPC ${name}`);
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(providerCalls, 1);
  assert.equal(res.payload.accessMode, 'trial');
  assert.equal(res.payload.remainingSearches, 2);
  assert.equal(res.payload.remainingAttempts, 4);
  assert.equal(res.payload.places.length, 1);
  assert.equal(rpcCalls[1].name, 'reserve_api_cost');
  assert.equal(rpcCalls[1].args.p_estimated_units, 3);
  assert.equal(rpcCalls[2].name, 'finish_api_cost_reservation_v2');
  assert.equal(rpcCalls[2].args.p_actual_units, 1);
  assert.equal(rpcCalls[3].name, 'finish_logical_search');
  assert.equal(rpcCalls[3].args.p_outcome, 'succeeded');
  assert.equal(rpcCalls[3].args.p_qualified_result, true);
});

test('successful paid search authorizes logical quota before wallet cost and commits both ledgers', async () => {
  const rpcCalls = [];
  let providerCalls = 0;
  global.fetch = async () => { providerCalls += 1; return googleOneResult(); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    resolveEntitlementSession: async () => ({ entitlementHash: 'entitlement-1' }),
    supabaseRpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'authorize_logical_search') {
        return [{ allowed: true, reason: 'reserved', access_mode: 'paid', logical_reservation_id: 'logical-1', remaining_searches: 9 }];
      }
      if (name === 'reserve_wallet_api_cost') return [{ allowed: true, reason: 'reserved', reservation_id: 'cost-1', replay_response: null }];
      if (name === 'finish_wallet_api_cost_reservation') return true;
      if (name === 'finish_logical_search') return [{ finalized: true, access_mode: 'paid', remaining_searches: 8 }];
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
  assert.equal(res.payload.accessMode, 'paid');
  assert.equal(res.payload.remainingSearches, 8);
  assert.deepEqual(rpcCalls.map((entry) => entry.name), [
    'authorize_logical_search',
    'reserve_wallet_api_cost',
    'finish_wallet_api_cost_reservation',
    'finish_logical_search',
  ]);
  assert.equal(rpcCalls[1].args.p_estimated_units, 3);
});

test('logical idempotent replay returns cached response before any cost reservation or Google call', async () => {
  let providerCalls = 0;
  const replay = { places: [{ id: 'cached', name: 'Cached result' }], accessMode: 'trial', costUnits: 1 };
  global.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  const handler = loadHandler({ entitlements: baseEntitlements({
    supabaseRpc: async (name) => {
      assert.equal(name, 'authorize_logical_search');
      return [{ allowed: false, reason: 'idempotent_replay', access_mode: 'trial', replay_response: replay }];
    },
  }) });
  const res = makeRes();

  await handler(makeReq({
    'x-neartime-device-id': 'device-1',
    'x-neartime-idempotency-key': 'search-key-0001',
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, replay);
  assert.equal(providerCalls, 0);
});
