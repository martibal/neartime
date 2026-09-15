'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LIST_PRICE_MICROUSD,
  SKU,
  createTextSearchEnrichmentAccelerator,
  estimateObservedEnrichmentCost,
  maxPagesWithinSpend,
  reconcileAggregateCandidates,
} = require('./lib/textSearchEnrichmentAccelerator');

test('official list-price constants use Text Search Enterprise and Enterprise + Atmosphere', () => {
  assert.equal(LIST_PRICE_MICROUSD.textSearchEnterprise, 35000);
  assert.equal(LIST_PRICE_MICROUSD.textSearchEnterpriseAtmosphere, 40000);
  assert.equal(LIST_PRICE_MICROUSD.placeDetailsEnterprise, 20000);
  assert.equal(SKU.TEXT_SEARCH_ENTERPRISE, 'E967-44BC-B44D');
  assert.equal(SKU.TEXT_SEARCH_ENTERPRISE_ATMOSPHERE, '120C-BEC3-B48F');
});

test('reconciliation measures overlap against Aggregate authority only', () => {
  const result = reconcileAggregateCandidates({
    aggregatePlaceIds: ['places/a', 'b', 'c', 'd'],
    textSearchPlaces: [
      { id: 'a', rating: 4.8 },
      { id: 'c', rating: 4.7 },
      { id: 'outside', rating: 5.0 },
      { id: 'c', rating: 4.7 },
    ],
  });

  assert.equal(result.aggregateCount, 4);
  assert.equal(result.matchedCount, 2);
  assert.equal(result.missingCount, 2);
  assert.equal(result.overlapRate, 0.5);
  assert.deepEqual(result.matchedIds, ['a', 'c']);
  assert.deepEqual(result.missingIds, ['b', 'd']);
});

test('cost estimate keeps overlap-dependent Details fallback explicit', () => {
  const highOverlap = estimateObservedEnrichmentCost({
    textSearchCalls: 3,
    missingCount: 0,
    includeRouting: false,
  });
  assert.equal(highOverlap.totalMicroUsd, 105000);

  const lowOverlap = estimateObservedEnrichmentCost({
    textSearchCalls: 3,
    missingCount: 23,
    includeRouting: false,
  });
  assert.equal(lowOverlap.totalMicroUsd, 565000);

  const withRouting = estimateObservedEnrichmentCost({
    textSearchCalls: 3,
    missingCount: 0,
    includeRouting: true,
  });
  assert.equal(withRouting.totalMicroUsd, 120000);
});

test('spend cap converts directly into a hard maximum page count', () => {
  assert.equal(maxPagesWithinSpend({ includeRouting: false, maxSpendMicroUsd: 0 }), 0);
  assert.equal(maxPagesWithinSpend({ includeRouting: false, maxSpendMicroUsd: 34999 }), 0);
  assert.equal(maxPagesWithinSpend({ includeRouting: false, maxSpendMicroUsd: 35000 }), 1);
  assert.equal(maxPagesWithinSpend({ includeRouting: false, maxSpendMicroUsd: 70000 }), 2);
  assert.equal(maxPagesWithinSpend({ includeRouting: false, maxSpendMicroUsd: 999999 }), 3);
  assert.equal(maxPagesWithinSpend({ includeRouting: true, maxSpendMicroUsd: 79999 }), 1);
  assert.equal(maxPagesWithinSpend({ includeRouting: true, maxSpendMicroUsd: 80000 }), 2);
});

test('scenario A paginates Text Search and preserves server-side filters', async () => {
  const requests = [];
  const responses = [
    {
      places: Array.from({ length: 20 }, (_, index) => ({ id: `p${index + 1}`, rating: 4.5 })),
      nextPageToken: 'page-2',
    },
    {
      places: Array.from({ length: 3 }, (_, index) => ({ id: `p${index + 21}`, rating: 4.4 })),
    },
  ];

  const accelerator = createTextSearchEnrichmentAccelerator({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      requests.push({ headers: init.headers, body: JSON.parse(init.body) });
      const payload = responses.shift();
      return {
        ok: true,
        json: async () => payload,
        text: async () => '',
      };
    },
  });

  const result = await accelerator.searchPages({
    textQuery: 'cafe',
    includedType: 'cafe',
    locationBiasCircle: {
      center: { latitude: 59.9139, longitude: 10.7522 },
      radius: 2500,
    },
    minRating: 4.0,
    openNow: true,
    priceLevels: ['PRICE_LEVEL_INEXPENSIVE'],
    includeRouting: false,
  });

  assert.equal(result.calls, 2);
  assert.equal(result.places.length, 23);
  assert.equal(result.exhausted, true);
  assert.equal(result.skuId, SKU.TEXT_SEARCH_ENTERPRISE);
  assert.equal(requests[0].body.pageSize, 20);
  assert.equal(requests[0].body.minRating, 4);
  assert.equal(requests[0].body.openNow, true);
  assert.deepEqual(requests[0].body.priceLevels, ['PRICE_LEVEL_INEXPENSIVE']);
  assert.equal(requests[1].body.pageToken, 'page-2');
  assert.equal(requests[0].headers['X-Goog-FieldMask'].includes('routingSummaries'), false);
});

test('target-aware paging stops before paying for an unnecessary second page', async () => {
  let calls = 0;
  const accelerator = createTextSearchEnrichmentAccelerator({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({
          places: [{ id: 'a' }, { id: 'b' }, { id: 'outside' }],
          nextPageToken: 'page-2',
        }),
        text: async () => '',
      };
    },
  });

  const result = await accelerator.searchPages({
    textQuery: 'grocery store',
    includedType: 'grocery_store',
    locationBiasCircle: {
      center: { latitude: 59.9139, longitude: 10.7522 },
      radius: 2500,
    },
    targetPlaceIds: ['a', 'b'],
    pageLimit: 3,
  });

  assert.equal(calls, 1);
  assert.equal(result.calls, 1);
  assert.equal(result.targetSatisfied, true);
  assert.equal(result.matchedTargetCount, 2);
  assert.equal(result.targetCount, 2);
  assert.equal(result.nextPageToken, 'page-2');
  assert.equal(result.exhausted, false);
});

test('spend cap prevents Text Search from exceeding its pre-authorized budget', async () => {
  let calls = 0;
  const accelerator = createTextSearchEnrichmentAccelerator({
    apiKey: 'test-key',
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ places: [{ id: 'a' }], nextPageToken: 'still-more' }),
        text: async () => '',
      };
    },
  });

  const result = await accelerator.searchPages({
    textQuery: 'restaurant',
    includedType: 'restaurant',
    locationBiasCircle: {
      center: { latitude: 59.9139, longitude: 10.7522 },
      radius: 5000,
    },
    pageLimit: 3,
    maxSpendMicroUsd: 70000,
  });

  assert.equal(calls, 2);
  assert.equal(result.calls, 2);
  assert.equal(result.stoppedBySpendCap, true);
  assert.equal(result.exhausted, false);
});

test('scenario B aligns routing summaries to returned places and uses Atmosphere SKU', async () => {
  const accelerator = createTextSearchEnrichmentAccelerator({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.routingParameters.travelMode, 'WALK');
      assert.deepEqual(body.routingParameters.origin, { latitude: 59.9139, longitude: 10.7522 });
      assert.equal(init.headers['X-Goog-FieldMask'].includes('routingSummaries'), true);
      return {
        ok: true,
        json: async () => ({
          places: [{ id: 'a' }, { id: 'b' }],
          routingSummaries: [
            { legs: [{ duration: '120s', distanceMeters: 150 }] },
            { legs: [{ duration: '180s', distanceMeters: 220 }] },
          ],
        }),
        text: async () => '',
      };
    },
  });

  const result = await accelerator.searchPages({
    textQuery: 'cafe',
    includedType: 'cafe',
    locationBiasCircle: {
      center: { latitude: 59.9139, longitude: 10.7522 },
      radius: 2500,
    },
    includeRouting: true,
    routingOrigin: { latitude: 59.9139, longitude: 10.7522 },
    travelMode: 'Walk',
  });

  assert.equal(result.calls, 1);
  assert.equal(result.skuId, SKU.TEXT_SEARCH_ENTERPRISE_ATMOSPHERE);
  assert.equal(result.places[0].routingSummary.legs[0].duration, '120s');
  assert.equal(result.places[1].routingSummary.legs[0].duration, '180s');
});

test('page limit is fail-closed at Google\'s documented maximum of three pages', async () => {
  const accelerator = createTextSearchEnrichmentAccelerator({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ places: [{ id: 'a' }], nextPageToken: 'still-more' }),
      text: async () => '',
    }),
  });

  const result = await accelerator.searchPages({
    textQuery: 'restaurant',
    includedType: 'restaurant',
    locationBiasCircle: {
      center: { latitude: 59.9139, longitude: 10.7522 },
      radius: 5000,
    },
    pageLimit: 3,
  });

  assert.equal(result.calls, 3);
  assert.equal(result.exhausted, false);
  assert.equal(result.nextPageToken, 'still-more');
});
