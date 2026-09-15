'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createGoogleIsochroneEnvelopeProvider,
  isTransientHttpStatus,
} = require('./lib/googleIsochroneEnvelopeProvider');

const ORIGIN = { latitude: 59.9139, longitude: 10.7522 };

function okPayload() {
  return {
    isochrone: {
      geoJson: {
        type: 'MultiPolygon',
        coordinates: [[[
          [10.75, 59.91],
          [10.76, 59.91],
          [10.76, 59.92],
          [10.75, 59.92],
          [10.75, 59.91],
        ]]],
      },
    },
  };
}

function response({ ok, status, body = '' }) {
  return {
    ok,
    status,
    async text() { return body; },
    async json() { return okPayload(); },
  };
}

test('transient HTTP statuses are narrowly allowlisted', () => {
  for (const status of [408, 429, 500, 502, 503, 504]) assert.equal(isTransientHttpStatus(status), true);
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(isTransientHttpStatus(status), false);
});

test('one transient provider failure is retried once with the exact same request', async () => {
  const requests = [];
  const sleeps = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return requests.length === 1
      ? response({ ok: false, status: 503, body: 'temporarily unavailable' })
      : response({ ok: true, status: 200 });
  };
  const provider = createGoogleIsochroneEnvelopeProvider({
    apiKey: 'test-key',
    fetchImpl,
    retryDelayMs: 25,
    sleepImpl: async (ms) => { sleeps.push(ms); },
  });

  const envelope = await provider.getEnvelope({ origin: ORIGIN, travelMode: 'Walk', maxMinutes: 10 });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(sleeps, [25]);
  assert.equal(envelope.requestAttempts, 2);
  assert.equal(envelope.retriedTransientFailure, true);
  assert.equal(envelope.polygonCount, 1);
});

test('non-transient HTTP failure fails closed without retry', async () => {
  let calls = 0;
  const provider = createGoogleIsochroneEnvelopeProvider({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      return response({ ok: false, status: 403, body: 'forbidden' });
    },
    retryDelayMs: 0,
  });

  await assert.rejects(
    provider.getEnvelope({ origin: ORIGIN, travelMode: 'Walk', maxMinutes: 10 }),
    (error) => error.code === 'isochrone_provider_failed' && error.attempts === 1 && /403:forbidden/.test(error.message),
  );
  assert.equal(calls, 1);
});

test('network failure is retried once, then still fails closed if the retry fails', async () => {
  let calls = 0;
  const provider = createGoogleIsochroneEnvelopeProvider({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('socket reset');
    },
    retryDelayMs: 0,
  });

  await assert.rejects(
    provider.getEnvelope({ origin: ORIGIN, travelMode: 'Walk', maxMinutes: 10 }),
    (error) => error.code === 'isochrone_provider_failed' && error.attempts === 2 && /network:socket reset/.test(error.message),
  );
  assert.equal(calls, 2);
});
