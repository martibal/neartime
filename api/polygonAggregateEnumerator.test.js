'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { enumeratePolygonCandidates } = require('./lib/polygonAggregateEnumerator');
const { splitRingForAggregate } = require('./lib/polygonPartition');

function osloSquare(sizeDegrees = 0.02) {
  const minLon = 10.74;
  const minLat = 59.90;
  return [
    [minLon, minLat],
    [minLon + sizeDegrees, minLat],
    [minLon + sizeDegrees, minLat + sizeDegrees],
    [minLon, minLat + sizeDegrees],
    [minLon, minLat],
  ];
}

test('count <=100 enumerates directly without partitioning', async () => {
  const calls = [];
  const ids = Array.from({ length: 78 }, (_, i) => `p${i + 1}`);
  const result = await enumeratePolygonCandidates({
    rootRing: osloSquare(),
    includedTypes: ['cafe'],
    searchKey: 'polygon-direct-0001',
    aggregateSearch: async ({ includePlaceIds }) => {
      calls.push(includePlaceIds);
      return includePlaceIds ? { count: 78, placeIds: ids } : { count: 78 };
    },
  });

  assert.equal(result.verified, true);
  assert.equal(result.reason, null);
  assert.equal(result.rootCount, 78);
  assert.equal(result.placeIds.length, 78);
  assert.equal(result.aggregateCalls, 2);
  assert.equal(result.leafCount, 1);
  assert.deepEqual(calls, [false, true]);
});

test('count >100 recursively splits and verifies union against root count', async () => {
  const root = osloSquare();
  const firstSplit = splitRingForAggregate(root);
  assert.equal(firstSplit.allowed, true);
  assert.equal(firstSplit.parts.length, 2);

  const childA = firstSplit.parts[0];
  const childB = firstSplit.parts[1];
  const key = (ring) => JSON.stringify(ring);
  const map = new Map([
    [key(root), { count: 150 }],
    [key(childA), { count: 80, ids: Array.from({ length: 80 }, (_, i) => `a${i + 1}`) }],
    [key(childB), { count: 70, ids: Array.from({ length: 70 }, (_, i) => `b${i + 1}`) }],
  ]);

  const result = await enumeratePolygonCandidates({
    rootRing: root,
    includedTypes: ['restaurant'],
    searchKey: 'polygon-split-0001',
    aggregateSearch: async ({ polygon, includePlaceIds }) => {
      const entry = map.get(key(polygon));
      assert.ok(entry, 'unexpected polygon');
      return includePlaceIds ? { count: entry.count, placeIds: entry.ids } : { count: entry.count };
    },
  });

  assert.equal(result.verified, true);
  assert.equal(result.rootCount, 150);
  assert.equal(result.placeIds.length, 150);
  assert.equal(result.leafCount, 2);
  assert.equal(result.aggregateCalls, 5);
});

test('dedupe cannot silently hide partition overlap because unique union must equal root count', async () => {
  const root = osloSquare();
  const split = splitRingForAggregate(root);
  const [childA, childB] = split.parts;
  const key = (ring) => JSON.stringify(ring);
  const idsA = Array.from({ length: 80 }, (_, i) => `p${i + 1}`);
  const idsB = Array.from({ length: 70 }, (_, i) => `p${i + 71}`); // 10 overlap, 140 unique total
  const map = new Map([
    [key(root), { count: 150 }],
    [key(childA), { count: 80, ids: idsA }],
    [key(childB), { count: 70, ids: idsB }],
  ]);

  const result = await enumeratePolygonCandidates({
    rootRing: root,
    includedTypes: ['cafe'],
    searchKey: 'polygon-overlap-0001',
    aggregateSearch: async ({ polygon, includePlaceIds }) => {
      const entry = map.get(key(polygon));
      return includePlaceIds ? { count: entry.count, placeIds: entry.ids } : { count: entry.count };
    },
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'aggregate_partition_candidate_count_mismatch');
  assert.equal(result.rootCount, 150);
  assert.equal(result.placeIds.length, 140);
});

test('split blocked by Aggregate minimum area returns degraded state instead of dropping coverage', async () => {
  const tiny = osloSquare(0.0004);
  const result = await enumeratePolygonCandidates({
    rootRing: tiny,
    includedTypes: ['cafe'],
    searchKey: 'polygon-small-0001',
    aggregateSearch: async () => ({ count: 101 }),
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'aggregate_polygon_below_minimum_area');
  assert.equal(result.aggregateCalls, 0);
});

test('depth exhaustion is fail-closed for dense polygon', async () => {
  const result = await enumeratePolygonCandidates({
    rootRing: osloSquare(),
    includedTypes: ['pharmacy'],
    searchKey: 'polygon-depth-0001',
    options: { maxDepth: 0 },
    aggregateSearch: async () => ({ count: 101 }),
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'aggregate_partition_depth_exhausted');
  assert.equal(result.rootCount, 101);
  assert.equal(result.placeIds.length, 0);
  assert.equal(result.aggregateCalls, 1);
});

test('Aggregate call budget exhaustion is fail-closed', async () => {
  const result = await enumeratePolygonCandidates({
    rootRing: osloSquare(),
    includedTypes: ['grocery_store'],
    searchKey: 'polygon-budget-0001',
    options: { maxAggregateCalls: 1 },
    aggregateSearch: async () => ({ count: 1, placeIds: ['x'] }),
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'aggregate_call_budget_exhausted');
  assert.equal(result.rootCount, 1);
  assert.equal(result.aggregateCalls, 1);
});
