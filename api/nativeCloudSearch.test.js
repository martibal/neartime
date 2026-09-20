'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');

const native = require('./native');
const t = native._test;

test('hard worst-case provider cost remains below NOK 0.30 without free tier', () => {
  assert.equal(t.MAX_ROUTE_CALLS, 24);
  assert.equal(t.WORST_CASE_SEARCH_COST_NOK, 0.299);
  assert.equal(t.costNok(1, 24), 0.299);
  assert.ok(t.WORST_CASE_SEARCH_COST_NOK <= t.SEARCH_COST_CAP_NOK);
});

test('all 52 native categories are supported', () => {
  assert.equal(Object.keys(t.CATEGORY_QUERY).length, 52);
});

test('ranking is by measured pedestrian route distance', () => {
  const places = t.topTenByWalkDistance([
    {
      name: 'A',
      walkDistanceMeters: 900,
      walkSeconds: 400,
      walkMinutes: 7,
    },
    {
      name: 'B',
      walkDistanceMeters: 600,
      walkSeconds: 500,
      walkMinutes: 9,
    },
  ], 15);

  assert.deepEqual(places.map(function (p) { return p.name; }), ['B', 'A']);
});

test('straight-line lower bound proves exact Top 10 only when safe', () => {
  const routed = Array.from({ length: 10 }, function (_, i) {
    return {
      name: String(i),
      walkDistanceMeters: 500 + i * 50,
      walkSeconds: 400 + i,
      walkMinutes: 8,
    };
  });

  const safeCandidates = [
    ...Array.from({ length: 10 }, function (_, i) {
      return { straightDistanceMeters: 100 + i * 20, isOpenNow: true };
    }),
    { straightDistanceMeters: 1000, isOpenNow: true },
  ];

  const safe = t.proofState({
    routed,
    candidates: safeCandidates,
    nextIndex: 10,
    maxWalkMinutes: 15,
    openNowOnly: false,
    failedLowerBounds: [],
  });
  assert.equal(safe.proven, true);

  const unsafeCandidates = safeCandidates.slice();
  unsafeCandidates[10] = { straightDistanceMeters: 700, isOpenNow: true };

  const unsafe = t.proofState({
    routed,
    candidates: unsafeCandidates,
    nextIndex: 10,
    maxWalkMinutes: 15,
    openNowOnly: false,
    failedLowerBounds: [],
  });
  assert.equal(unsafe.proven, false);
});

test('failed routes remain proof blockers', () => {
  const routed = Array.from({ length: 10 }, function (_, i) {
    return {
      name: String(i),
      walkDistanceMeters: 500 + i * 50,
      walkSeconds: 400 + i,
      walkMinutes: 8,
    };
  });

  const proof = t.proofState({
    routed,
    candidates: [],
    nextIndex: 0,
    maxWalkMinutes: 15,
    openNowOnly: false,
    failedLowerBounds: [600],
  });

  assert.equal(proof.proven, false);
});

test('unknown open status remains a proof blocker for open-now searches', () => {
  const routed = Array.from({ length: 10 }, function (_, i) {
    return {
      name: String(i),
      walkDistanceMeters: 500 + i * 50,
      walkSeconds: 400 + i,
      walkMinutes: 8,
    };
  });

  const candidates = [
    { straightDistanceMeters: 550, isOpenNow: null },
  ];

  const proof = t.proofState({
    routed,
    candidates,
    nextIndex: 1,
    maxWalkMinutes: 15,
    openNowOnly: true,
    failedLowerBounds: [],
  });

  assert.equal(proof.proven, false);
});

test('source contains no local routing engine or localhost backend', () => {
  const source = fs.readFileSync(require.resolve('./native'), 'utf8');

  assert.equal(source.toLowerCase().includes('valhalla'), false);
  assert.equal(source.includes('127.0.0.1'), false);
  assert.equal(source.includes('osm.pbf'), false);
  assert.ok(source.includes("url.searchParams.set('travelMode', 'pedestrian')"));
  assert.ok(source.includes('/maps/orbis/places/discover'));
  assert.ok(source.includes('/routing/1/calculateRoute/'));
});

test('search input allows international coordinates and enforces max walk range', () => {
  const tokyo = t.validateSearch({
    latitude: 35.6762,
    longitude: 139.6503,
    category: 'restaurants',
    maxWalkMinutes: 15,
  });
  assert.equal(tokyo.category, 'restaurants');

  const newYork = t.validateSearch({
    latitude: 40.7128,
    longitude: -74.0060,
    category: 'cafes_coffee',
    maxWalkMinutes: 30,
  });
  assert.equal(newYork.maxWalkMinutes, 30);

  assert.throws(function () {
    t.validateSearch({
      latitude: 59.91,
      longitude: 10.75,
      category: 'restaurants',
      maxWalkMinutes: 31,
    });
  }, /INVALID_WALK_LIMIT/);
});


test('rated searches keep distance-ranked Nearby acquisition and filter rating locally', () => {
  const source = fs.readFileSync(
    require.resolve('../supabase/functions/native-search/index.ts'),
    'utf8'
  );

  assert.ok(source.includes("'https://places.googleapis.com/v1/places:searchNearby'"));
  assert.ok(source.includes("LOCAL_HARD_MIN_RATING_"));
  assert.ok(source.includes("rating < input.minRating"));
  assert.equal(source.includes("const useTextSearch = input.minRating > 0"), false);
});
