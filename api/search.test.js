const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

function loadSearchModuleForTests() {
  const filename = path.join(__dirname, 'search.js');
  const source = fs.readFileSync(filename, 'utf8');
  const testExports = `\nmodule.exports.__test = {\n  validateRequest,\n  sanitizeDeviceId,\n  radiusFor,\n  restrictionRectangle,\n  safeGoogleMinRating,\n  parseDurationSeconds,\n  closingMinutes,\n  priceInfo,\n  mapGooglePlace,\n  applyHardFilters,\n  sortByTravelTime,\n  buildTextSearchBody,\n};\n`;

  const testModule = new Module(filename, module);
  testModule.filename = filename;
  testModule.paths = Module._nodeModulePaths(path.dirname(filename));
  testModule._compile(source + testExports, filename);
  return testModule.exports.__test;
}

const api = loadSearchModuleForTests();

function baseQuery(overrides = {}) {
  return {
    category: 'Restaurant',
    travelMode: 'Walk',
    maxMinutes: 10,
    minimumRating: 4.3,
    minimumReviews: 100,
    openNow: true,
    openForMinutes: 120,
    ...overrides,
  };
}

function basePlace(overrides = {}) {
  return {
    id: 'p1',
    name: 'Example',
    category: 'Restaurant',
    walkMinutes: 8,
    driveMinutes: 9999,
    bikeMinutes: 9999,
    distanceMeters: 600,
    rating: 4.4,
    reviewCount: 150,
    priceLevel: 2,
    price: '$$',
    open: true,
    closesInMinutes: 180,
    address: 'Example street',
    phone: '',
    website: '',
    highlights: [],
    latitudeOffset: 0.001,
    longitudeOffset: 0.001,
    ...overrides,
  };
}

test('safeGoogleMinRating floors to a provider-safe 0.5 boundary', () => {
  assert.equal(api.safeGoogleMinRating(4.3), 4.0);
  assert.equal(api.safeGoogleMinRating(4.5), 4.5);
  assert.equal(api.safeGoogleMinRating(4.9), 4.5);
  assert.equal(api.safeGoogleMinRating(5), 5);
});

test('validateRequest accepts the supported query contract and rejects invalid inputs', () => {
  const valid = {
    query: baseQuery(),
    origin: { latitude: 59.91, longitude: 10.75 },
  };

  assert.equal(api.validateRequest(valid), null);
  assert.equal(api.validateRequest({ ...valid, query: baseQuery({ category: 'Hotel' }) }), 'invalid_category');
  assert.equal(api.validateRequest({ ...valid, query: baseQuery({ maxMinutes: 7 }) }), 'invalid_max_minutes');
  assert.equal(api.validateRequest({ ...valid, origin: { latitude: 91, longitude: 10.75 } }), 'invalid_latitude');
});

test('sanitizeDeviceId fails safely to the prototype id and caps length', () => {
  assert.equal(api.sanitizeDeviceId(undefined), 'prototype-device');
  assert.equal(api.sanitizeDeviceId('   '), 'prototype-device');
  assert.equal(api.sanitizeDeviceId(' device-1 '), 'device-1');
  assert.equal(api.sanitizeDeviceId('x'.repeat(200)).length, 128);
});

test('parseDurationSeconds handles Google duration strings defensively', () => {
  assert.equal(api.parseDurationSeconds('601s'), 601);
  assert.equal(api.parseDurationSeconds('0s'), 0);
  assert.equal(api.parseDurationSeconds('-1s'), null);
  assert.equal(api.parseDurationSeconds('10m'), null);
  assert.equal(api.parseDurationSeconds(undefined), null);
});

test('closingMinutes enforces open state and remaining-open duration', () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-14T10:00:00Z');
  try {
    assert.equal(api.closingMinutes({ openNow: false, nextCloseTime: '2026-09-14T12:00:00Z' }), 0);
    assert.equal(api.closingMinutes({ openNow: true, nextCloseTime: '2026-09-14T12:30:00Z' }), 150);
    assert.equal(api.closingMinutes({ openNow: true }), 7 * 24 * 60);
    assert.equal(api.closingMinutes({ openNow: true, nextCloseTime: 'invalid' }), 0);
  } finally {
    Date.now = originalNow;
  }
});

test('mapGooglePlace maps selected travel mode and rounds travel time up', () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-09-14T10:00:00Z');
  try {
    const place = {
      id: 'google-1',
      displayName: { text: 'Test Restaurant' },
      formattedAddress: 'Plogveien 6',
      location: { latitude: 59.91, longitude: 10.82 },
      rating: 4.4,
      userRatingCount: 200,
      priceLevel: 'PRICE_LEVEL_MODERATE',
      currentOpeningHours: { openNow: true, nextCloseTime: '2026-09-14T13:00:00Z' },
    };
    const routingSummary = { legs: [{ duration: '541s', distanceMeters: 610 }] };
    const origin = { latitude: 59.90, longitude: 10.80 };
    const mapped = api.mapGooglePlace(place, routingSummary, origin, baseQuery());

    assert.equal(mapped.walkMinutes, 10);
    assert.equal(mapped.driveMinutes, 9999);
    assert.equal(mapped.bikeMinutes, 9999);
    assert.equal(mapped.distanceMeters, 610);
    assert.equal(mapped.rating, 4.4);
    assert.equal(mapped.reviewCount, 200);
    assert.equal(mapped.price, '$$');
    assert.equal(mapped.closesInMinutes, 180);
  } finally {
    Date.now = originalNow;
  }
});

test('mapGooglePlace rejects candidates without routing duration or coordinates', () => {
  const origin = { latitude: 59.90, longitude: 10.80 };
  const place = { id: 'p', location: { latitude: 59.91, longitude: 10.82 } };
  assert.equal(api.mapGooglePlace(place, { legs: [{}] }, origin, baseQuery()), null);
  assert.equal(api.mapGooglePlace({ id: 'p' }, { legs: [{ duration: '300s' }] }, origin, baseQuery()), null);
});

test('applyHardFilters implements AND semantics for every hard constraint', () => {
  const query = baseQuery();
  const passing = basePlace({ id: 'passing' });
  const candidates = [
    passing,
    basePlace({ id: 'too-slow', walkMinutes: 11 }),
    basePlace({ id: 'rating', rating: 4.2 }),
    basePlace({ id: 'reviews', reviewCount: 99 }),
    basePlace({ id: 'closed', open: false }),
    basePlace({ id: 'closes-soon', closesInMinutes: 119 }),
  ];

  assert.deepEqual(api.applyHardFilters(candidates, query).map((place) => place.id), ['passing']);
});

test('applyHardFilters uses the selected travel-mode duration', () => {
  const place = basePlace({ walkMinutes: 50, driveMinutes: 7, bikeMinutes: 20 });
  const query = baseQuery({ travelMode: 'Drive' });
  assert.equal(api.applyHardFilters([place], query).length, 1);
});

test('sortByTravelTime sorts by travel time then distance without mutating input', () => {
  const places = [
    basePlace({ id: 'b', walkMinutes: 8, distanceMeters: 700 }),
    basePlace({ id: 'a', walkMinutes: 8, distanceMeters: 500 }),
    basePlace({ id: 'c', walkMinutes: 9, distanceMeters: 100 }),
  ];
  const originalIds = places.map((place) => place.id);

  assert.deepEqual(api.sortByTravelTime(places, baseQuery()).map((place) => place.id), ['a', 'b', 'c']);
  assert.deepEqual(places.map((place) => place.id), originalIds);
});

test('buildTextSearchBody keeps NearTime hard filters from becoming stricter at Google', () => {
  const query = baseQuery({ minimumRating: 4.3, openNow: false, openForMinutes: 120 });
  const origin = { latitude: 59.91, longitude: 10.75 };
  const body = api.buildTextSearchBody(query, origin, 'next-token');

  assert.equal(body.textQuery, 'restaurants');
  assert.equal(body.includedType, 'restaurant');
  assert.equal(body.strictTypeFiltering, true);
  assert.equal(body.minRating, 4.0);
  assert.equal(body.openNow, true);
  assert.equal(body.routingParameters.travelMode, 'WALK');
  assert.equal(body.pageToken, 'next-token');
});

test('radiusFor remains bounded and mode-sensitive', () => {
  assert.equal(api.radiusFor(baseQuery({ travelMode: 'Walk', maxMinutes: 5 })), 750);
  assert.equal(api.radiusFor(baseQuery({ travelMode: 'Bike', maxMinutes: 20 })), 12000);
  assert.equal(api.radiusFor(baseQuery({ travelMode: 'Drive', maxMinutes: 20 })), 50000);
});
