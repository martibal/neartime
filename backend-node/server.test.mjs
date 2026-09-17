import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.USAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'neartime-cost-gate-'));
process.env.TOMTOM_API_KEY = 'test-tomtom';
process.env.VALHALLA_BASE_URL = 'http://127.0.0.1:8002';

const mod = await import('./server.js');

test('backend exposes exactly 52 categories with discovery queries', () => {
  const ids = Object.keys(mod.CATEGORY_CONFIG);
  assert.equal(ids.length, 52);
  for (const id of ids) {
    const cfg = mod.CATEGORY_CONFIG[id];
    assert.equal(typeof cfg.label, 'string');
    assert.ok(cfg.label.trim().length > 0);
    assert.equal(typeof cfg.query, 'string');
    assert.ok(cfg.query.trim().length > 0);
  }
});

test('normal search source contains one paid discovery path and no paid routing path', () => {
  const source = fs.readFileSync('./server.js', 'utf8');
  assert.ok(source.includes('/maps/orbis/places/discover'));
  assert.ok(source.includes('/sources_to_targets'));
  assert.ok(source.includes('const TOMTOM_DISCOVER_CALLS_PER_SEARCH_CAP = 1'));
  assert.ok(source.includes('const VALHALLA_MATRIX_CALLS_PER_SEARCH_CAP = 1'));
  assert.equal(source.includes('places.googleapis.com/v1/places'), false);
  assert.equal(source.includes('api.tomtom.com/routing/'), false);
});

test('cost contract explicitly reports zero Google Places and zero paid routing', () => {
  const source = fs.readFileSync('./server.js', 'utf8');
  assert.ok(source.includes('paidPedestrianRoutingCallsPerExplicitSearch: 0'));
  assert.ok(source.includes('googlePlacesCallsPerExplicitSearch: 0'));
});

test('search input validates walking limit and categories', () => {
  const valid = mod.validateSearchInput({
    latitude: 59.91,
    longitude: 10.75,
    category: 'restaurants',
    maxWalkMinutes: 15,
    openNowOnly: false
  });
  assert.equal(valid.maxWalkMinutes, 15);
  assert.equal(valid.category, 'restaurants');
  assert.throws(() => mod.validateSearchInput({
    latitude: 59.91,
    longitude: 10.75,
    category: 'not_a_category',
    maxWalkMinutes: 15
  }), /INVALID_CATEGORY/);
});

test('open-now logic handles an offset-backed live interval', () => {
  const hours = [{
    date: '2026-09-18',
    timeRanges: [{ start: '10:00', end: '22:00', utcOffsetSeconds: 7200 }]
  }];
  const during = Date.UTC(2026, 8, 18, 12, 0, 0);
  const after = Date.UTC(2026, 8, 18, 21, 0, 0);
  assert.equal(mod.isOpenAtEpoch(hours, during), true);
  assert.equal(mod.isOpenAtEpoch(hours, after), false);
});

test('open-now normalization fails closed when opening hours are missing', () => {
  const config = mod.CATEGORY_CONFIG.restaurants;
  const base = {
    id: 'poi-1',
    type: 'poi',
    title: 'Restaurant One',
    position: { coordinates: [10.75, 59.91] },
    poiTypes: [{ id: 'restaurant', name: 'Restaurant' }]
  };
  assert.equal(mod.normalizeTomTomPlace(base, config, true, Date.UTC(2026, 8, 18, 12, 0, 0)), null);
});

test('normal discovery result is source verified and keeps compatibility alias', () => {
  const config = mod.CATEGORY_CONFIG.restaurants;
  const place = mod.normalizeTomTomPlace({
    id: 'poi-2',
    type: 'poi',
    title: 'Restaurant Two',
    position: { coordinates: [10.75, 59.91] },
    poiTypes: [{ id: 'restaurant', name: 'Restaurant' }],
    address: { street: 'Testveien', houseNumber: '1', postalCode: '0001', municipality: 'Oslo' }
  }, config, false);
  assert.ok(place);
  assert.equal(place.sourceVerified, true);
  assert.equal(place.googleOperationalVerified, true);
  assert.equal(place.isOpenNow, null);
  assert.equal(place.address, 'Testveien 1, 0001 Oslo');
});

test('matrix response extraction supports one-source Valhalla shape', () => {
  const row = mod._test.extractMatrixRow({
    sources_to_targets: [[{ time: 120, distance: 0.2 }, { time: 300, distance: 0.45 }]]
  });
  assert.equal(row.length, 2);
  assert.equal(row[0].time, 120);
});
