'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runPolygonCoveragePath } = require('./lib/polygonCoveragePath');

function envelope(polygons, discardedHoleCount = 0) {
  return {
    provider: 'google-isochrones',
    version: 'test',
    preview: true,
    polygons,
    polygonCount: polygons.length,
    discardedHoleCount,
  };
}

function square(minLon, minLat, maxLon, maxLat) {
  return [
    { longitude: minLon, latitude: minLat },
    { longitude: maxLon, latitude: minLat },
    { longitude: maxLon, latitude: maxLat },
    { longitude: minLon, latitude: maxLat },
    { longitude: minLon, latitude: minLat },
  ];
}

test('single isochrone polygon enumerates a verified <=100 candidate universe end-to-end', async () => {
  const calls = [];
  const envelopeProvider = {
    getEnvelope: async () => envelope([square(10.74, 59.90, 10.77, 59.93)]),
  };
  const ids = Array.from({ length: 78 }, (_, index) => `places/p${index + 1}`);

  const result = await runPolygonCoveragePath({
    envelopeProvider,
    aggregateSearch: async ({ polygon, includePlaceIds }) => {
      calls.push({ polygon, includePlaceIds });
      return includePlaceIds ? { count: 78, placeIds: ids } : { count: 78 };
    },
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    maxMinutes: 10,
    includedTypes: ['cafe'],
    searchKey: 'polygon-live-shape-0001',
  });

  assert.equal(result.verified, true);
  assert.equal(result.reason, null);
  assert.equal(result.expectedCount, 78);
  assert.equal(result.placeIds.length, 78);
  assert.equal(result.aggregateCalls, 2);
  assert.equal(calls.length, 2);
  assert.ok(Array.isArray(calls[0].polygon));
  assert.deepEqual(calls[0].polygon[0], [10.74, 59.90]);
});

test('multiple verified exterior shells are unioned only when counts remain exact', async () => {
  const polygons = [
    square(10.70, 59.90, 10.72, 59.92),
    square(10.80, 59.90, 10.82, 59.92),
  ];
  let rootCall = 0;
  const result = await runPolygonCoveragePath({
    envelopeProvider: { getEnvelope: async () => envelope(polygons) },
    aggregateSearch: async ({ includePlaceIds }) => {
      const polygonIndex = Math.floor(rootCall / 2);
      rootCall += 1;
      const ids = polygonIndex === 0 ? ['places/a', 'places/b'] : ['places/c'];
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    maxMinutes: 10,
    includedTypes: ['cafe'],
    searchKey: 'polygon-shells-0001',
  });

  assert.equal(result.verified, true);
  assert.equal(result.expectedCount, 3);
  assert.deepEqual(result.placeIds.sort(), ['a', 'b', 'c']);
});

test('discarded isochrone holes fail closed before Aggregate calls', async () => {
  let calls = 0;
  const result = await runPolygonCoveragePath({
    envelopeProvider: { getEnvelope: async () => envelope([square(10.74, 59.90, 10.77, 59.93)], 1) },
    aggregateSearch: async () => { calls += 1; return { count: 0 }; },
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    maxMinutes: 10,
    includedTypes: ['cafe'],
    searchKey: 'polygon-hole-0001',
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'isochrone_holes_not_supported_exactly');
  assert.equal(calls, 0);
});

test('cross-shell duplicate candidates fail closed instead of overstating exact coverage', async () => {
  const polygons = [
    square(10.70, 59.90, 10.72, 59.92),
    square(10.80, 59.90, 10.82, 59.92),
  ];
  let call = 0;
  const result = await runPolygonCoveragePath({
    envelopeProvider: { getEnvelope: async () => envelope(polygons) },
    aggregateSearch: async ({ includePlaceIds }) => {
      const polygonIndex = Math.floor(call / 2);
      call += 1;
      const ids = polygonIndex === 0 ? ['places/a', 'places/shared'] : ['places/shared', 'places/b'];
      return includePlaceIds ? { count: 2, placeIds: ids } : { count: 2 };
    },
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    maxMinutes: 10,
    includedTypes: ['cafe'],
    searchKey: 'polygon-overlap-0001',
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'cross_polygon_candidate_count_mismatch');
  assert.equal(result.expectedCount, 4);
  assert.equal(result.placeIds.length, 3);
});

test('enumeration failure propagates as fail-closed polygon coverage result', async () => {
  const result = await runPolygonCoveragePath({
    envelopeProvider: { getEnvelope: async () => envelope([square(10.74, 59.90, 10.77, 59.93)]) },
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds
      ? { count: 3, placeIds: ['places/a', 'places/b'] }
      : { count: 3 },
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    maxMinutes: 10,
    includedTypes: ['cafe'],
    searchKey: 'polygon-fail-0001',
  });

  assert.equal(result.verified, false);
  assert.equal(result.reason, 'aggregate_place_ids_incomplete');
});
