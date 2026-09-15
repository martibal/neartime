'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GEOMETRY_CONTRACT_VERSION,
  buildCoverageEnvelope,
} = require('./lib/coverageGeometry');

test('coverage geometry v1 uses explicit conservative envelopes', () => {
  assert.deepEqual(buildCoverageEnvelope({ travelMode: 'Walk', maxMinutes: 20 }), {
    version: GEOMETRY_CONTRACT_VERSION,
    travelMode: 'Walk',
    maxMinutes: 20,
    maxStraightLineKmh: 15,
    radiusMeters: 5000,
    providerCircleLimitMeters: 50000,
  });
  assert.equal(buildCoverageEnvelope({ travelMode: 'Bike', maxMinutes: 20 }).radiusMeters, 20000);
  assert.equal(buildCoverageEnvelope({ travelMode: 'Drive', maxMinutes: 20 }).radiusMeters, 50000);
});

test('envelope scales with requested time instead of using the old heuristic', () => {
  assert.equal(buildCoverageEnvelope({ travelMode: 'Drive', maxMinutes: 5 }).radiusMeters, 12500);
  assert.equal(buildCoverageEnvelope({ travelMode: 'Bike', maxMinutes: 10 }).radiusMeters, 10000);
  assert.equal(buildCoverageEnvelope({ travelMode: 'Walk', maxMinutes: 15 }).radiusMeters, 3750);
});

test('unsupported geometry fails closed', () => {
  assert.throws(
    () => buildCoverageEnvelope({ travelMode: 'Drive', maxMinutes: 21 }),
    (error) => error.code === 'coverage_geometry_unsupported_minutes',
  );
  assert.throws(
    () => buildCoverageEnvelope({ travelMode: 'Teleport', maxMinutes: 5 }),
    (error) => error.code === 'coverage_geometry_invalid_travel_mode',
  );
});
