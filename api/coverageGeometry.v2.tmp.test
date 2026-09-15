'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GEOMETRY_CONTRACT_VERSION,
  ROUTE_BOUND_SOURCE,
  buildCoverageEnvelope,
} = require('./lib/coverageGeometry');

test('geometry contract refuses invented speed-derived radii', () => {
  assert.throws(
    () => buildCoverageEnvelope({ travelMode: 'Walk', maxMinutes: 20 }),
    (error) => error.code === 'coverage_geometry_route_bound_required',
  );
});

test('geometry accepts only an explicit Google-Routes-derived acquisition bound', () => {
  assert.deepEqual(
    buildCoverageEnvelope(
      { travelMode: 'Walk', maxMinutes: 20 },
      {
        source: ROUTE_BOUND_SOURCE,
        travelMode: 'Walk',
        maxMinutes: 20,
        radiusMeters: 2100.2,
      },
    ),
    {
      version: GEOMETRY_CONTRACT_VERSION,
      authority: 'google-routes',
      source: ROUTE_BOUND_SOURCE,
      travelMode: 'Walk',
      maxMinutes: 20,
      radiusMeters: 2101,
      providerCircleLimitMeters: 50000,
    },
  );
});

test('mismatched or oversized route bounds fail closed', () => {
  assert.throws(
    () => buildCoverageEnvelope(
      { travelMode: 'Bike', maxMinutes: 10 },
      { source: ROUTE_BOUND_SOURCE, travelMode: 'Walk', maxMinutes: 10, radiusMeters: 2000 },
    ),
    (error) => error.code === 'coverage_geometry_route_bound_mismatch',
  );
  assert.throws(
    () => buildCoverageEnvelope(
      { travelMode: 'Drive', maxMinutes: 20 },
      { source: ROUTE_BOUND_SOURCE, travelMode: 'Drive', maxMinutes: 20, radiusMeters: 50001 },
    ),
    (error) => error.code === 'coverage_geometry_exceeds_provider_limit',
  );
});
