'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempUsage = fs.mkdtempSync(path.join(os.tmpdir(), 'neartime-test-'));
process.env.USAGE_DIR = tempUsage;
process.env.TOMTOM_API_KEY = 'test-tomtom';
process.env.GOOGLE_PLACES_API_KEY = 'test-google';

const backend = require('./server.js');

function response(status, obj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(obj); }
  };
}

function tomtomPoi(id, name, category, lat, lon, dist = 100) {
  return {
    id,
    dist,
    position: { lat, lon },
    poi: {
      name,
      categories: [category],
      timeZone: { ianaId: 'Europe/Oslo' }
    },
    address: { freeformAddress: `${name} address, Oslo` }
  };
}

const searchCandidates = [
  tomtomPoi('closed-old', 'Old Closed Pub', 'Pub', 59.9111, 10.7523, 40),
  tomtomPoi('wrong-type', 'Coffee Only', 'Cafe', 59.9112, 10.7524, 50),
  tomtomPoi('moved', 'Moved Bar', 'Bar', 59.9113, 10.7525, 60),
  ...Array.from({length: 12}, (_, i) =>
    tomtomPoi(`bar-${i+1}`, `Live Bar ${i+1}`, i === 0 ? 'Cocktail Bar' : 'Bar',
      59.9115 + i*0.0001, 10.7526 + i*0.0001, 70+i)
  )
];

const googlePlaces = [
  {
    id: 'gclosed',
    displayName: { text: 'Old Closed Pub' },
    location: { latitude: 59.9111, longitude: 10.7523 },
    businessStatus: 'CLOSED_PERMANENTLY'
  },
  {
    id: 'gmoved',
    displayName: { text: 'Moved Bar' },
    location: { latitude: 59.9113, longitude: 10.7525 },
    businessStatus: 'OPERATIONAL',
    movedPlaceId: 'new-place-id'
  },
  ...Array.from({length: 12}, (_, i) => ({
    id: `gbar-${i+1}`,
    displayName: { text: `Live Bar ${i+1}` },
    location: { latitude: 59.9115 + i*0.0001, longitude: 10.7526 + i*0.0001 },
    businessStatus: 'OPERATIONAL'
  }))
];

let calls;

function installFetchMock() {
  calls = { tomtomSearch: 0, google: 0, route: 0, suggest: 0, details: 0 };

  global.fetch = async (url, options = {}) => {
    const value = String(url);

    if (value.includes('/search/2/poiSearch/')) {
      calls.tomtomSearch++;
      return response(200, { results: searchCandidates });
    }

    if (value.includes('places.googleapis.com/v1/places:searchText')) {
      calls.google++;
      return response(200, { places: googlePlaces });
    }

    if (value.includes('/routing/1/calculateRoute/')) {
      calls.route++;
      return response(200, {
        routes: [{
          summary: {
            travelTimeInSeconds: 300 + calls.route * 15,
            lengthInMeters: 350 + calls.route * 20
          }
        }]
      });
    }

    if (value.includes('/maps/orbis/places/suggest')) {
      calls.suggest++;
      return response(200, {
        results: [{
          id: 'oslo-s',
          type: 'poi',
          title: 'Oslo S',
          subtitles: ['Jernbanetorget, Oslo']
        }]
      });
    }

    if (value.includes('/maps/orbis/places/details/pois/oslo-s')) {
      calls.details++;
      return response(200, {
        id: 'oslo-s',
        type: 'poi',
        title: 'Oslo S',
        position: { coordinates: [10.7522, 59.9110] },
        address: {
          street: 'Jernbanetorget',
          houseNumber: '1',
          postalCode: '0154',
          municipality: 'Oslo'
        }
      });
    }

    throw new Error(`Unexpected fetch: ${value}`);
  };
}

test.beforeEach(() => {
  fs.rmSync(tempUsage, { recursive: true, force: true });
  fs.mkdirSync(tempUsage, { recursive: true });
  installFetchMock();
});

test('Android/server wire category contract: all 45 backend categories validate', () => {
  const keys = Object.keys(backend.CATEGORY_CONFIG);
  assert.equal(keys.length, 45);
  for (const category of keys) {
    const parsed = backend.validateSearchInput({
      latitude: 59.91,
      longitude: 10.75,
      category,
      maxWalkMinutes: 15
    });
    assert.equal(parsed.category, category);
  }
});

test('unknown category fails with INVALID_CATEGORY', () => {
  assert.throws(
    () => backend.validateSearchInput({
      latitude: 59.91,
      longitude: 10.75,
      category: 'not_real',
      maxWalkMinutes: 15
    }),
    /INVALID_CATEGORY/
  );
});

test('source label is individual POI label, not search category label', () => {
  const config = backend.CATEGORY_CONFIG.bars_drinks;
  const normalized = backend.normalizeTomTomPoi(
    tomtomPoi('x', 'Specific Place', 'Cocktail Bar', 59.91, 10.75),
    config
  );
  assert.ok(normalized);
  assert.equal(normalized.categoryLabel, 'Cocktail Bar');
  assert.notEqual(normalized.categoryLabel, config.label);
});

test('wrong POI type is rejected before results', () => {
  const config = backend.CATEGORY_CONFIG.bars_drinks;
  const normalized = backend.normalizeTomTomPoi(
    tomtomPoi('x', 'Coffee Only', 'Cafe', 59.91, 10.75),
    config
  );
  assert.equal(normalized, null);
});

test('closed and moved businesses are rejected by Google freshness gate', () => {
  const closedCandidate = backend.normalizeTomTomPoi(
    searchCandidates[0],
    backend.CATEGORY_CONFIG.bars_drinks
  );
  const movedCandidate = backend.normalizeTomTomPoi(
    searchCandidates[2],
    backend.CATEGORY_CONFIG.bars_drinks
  );
  const pool = googlePlaces.map(p => ({
    id: p.id,
    name: p.displayName.text,
    latitude: p.location.latitude,
    longitude: p.location.longitude,
    businessStatus: p.businessStatus,
    movedPlaceId: p.movedPlaceId || null
  }));

  assert.equal(backend.matchOperationalGoogle(closedCandidate, pool), false);
  assert.equal(backend.matchOperationalGoogle(movedCandidate, pool), false);
});

test('full search returns max 10, excludes stale/wrong types, and uses one Google call', async () => {
  const result = await backend.executeSearch({
    latitude: 59.9110,
    longitude: 10.7522,
    category: 'bars_drinks',
    maxWalkMinutes: 15,
    openNowOnly: false
  });

  assert.equal(result.places.length, 10);
  assert.equal(calls.google, 1);
  assert.equal(calls.tomtomSearch, 1);
  assert.ok(calls.route <= 20);
  assert.ok(result.places.every(p => p.googleOperationalVerified === true));
  assert.ok(result.places.every(p => p.name !== 'Old Closed Pub'));
  assert.ok(result.places.every(p => p.name !== 'Moved Bar'));
  assert.ok(result.places.every(p => p.name !== 'Coffee Only'));
  assert.equal(result.places[0].categoryLabel, 'Cocktail Bar');
});

test('one search never performs per-result Google verification', async () => {
  await backend.executeSearch({
    latitude: 59.9110,
    longitude: 10.7522,
    category: 'bars_drinks',
    maxWalkMinutes: 15,
    openNowOnly: false
  });
  assert.equal(calls.google, 1);
});

test('custom location lookup happens only when explicitly called and resolves coordinates', async () => {
  assert.equal(calls.suggest, 0);
  const suggested = await backend.suggestLocations({
    query: 'Oslo S',
    latitude: 59.91,
    longitude: 10.75
  });
  assert.equal(calls.suggest, 1);
  assert.equal(suggested.suggestions.length, 1);

  const resolved = await backend.resolveSuggestedLocation({
    id: suggested.suggestions[0].id,
    type: suggested.suggestions[0].type
  });
  assert.equal(calls.details, 1);
  assert.equal(resolved.title, 'Oslo S');
  assert.equal(resolved.latitude, 59.911);
  assert.equal(resolved.longitude, 10.7522);
});

test('results beyond walking-time limit are rejected', async () => {
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.includes('/search/2/poiSearch/')) {
      calls.tomtomSearch++;
      return response(200, { results: [tomtomPoi('bar-1', 'Live Bar 1', 'Bar', 59.9115, 10.7526)] });
    }
    if (value.includes('places.googleapis.com/v1/places:searchText')) {
      calls.google++;
      return response(200, { places: [googlePlaces.find(p => p.id === 'gbar-1')] });
    }
    if (value.includes('/routing/1/calculateRoute/')) {
      calls.route++;
      return response(200, { routes: [{ summary: { travelTimeInSeconds: 31 * 60, lengthInMeters: 2500 } }] });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const result = await backend.executeSearch({
    latitude: 59.9110,
    longitude: 10.7522,
    category: 'bars_drinks',
    maxWalkMinutes: 30,
    openNowOnly: false
  });
  assert.equal(result.places.length, 0);
});

test('monthly cap fails closed before additional provider call', async () => {
  backend._test.saveUsage({
    ...backend._test.emptyUsage(),
    googleTextSearchPro: backend.MONTHLY_LIMITS.googleTextSearchPro
  });

  await assert.rejects(
    backend.executeSearch({
      latitude: 59.9110,
      longitude: 10.7522,
      category: 'bars_drinks',
      maxWalkMinutes: 15,
      openNowOnly: false
    }),
    /API_TEST_BUDGET_EXHAUSTED/
  );

  assert.equal(calls.google, 0);
});
