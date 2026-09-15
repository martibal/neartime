'use strict';

// Coverage geometry v1 is part of the product contract, not a performance heuristic.
// A candidate can only be called COMPLETE if it lies inside this conservative
// straight-line envelope and all candidates inside that envelope are verified.
//
// The speed ceilings are explicit supported-universe limits. They are deliberately
// generous relative to ordinary travel and are versioned so widening them later is
// a contract change, not a silent implementation tweak.
const GEOMETRY_CONTRACT_VERSION = 'coverage-geometry-v1';
const MAX_MINUTES = 20;
const MAX_GOOGLE_CIRCLE_RADIUS_METERS = 50000;

const MODE_MAX_STRAIGHT_LINE_KMH = Object.freeze({
  Walk: 15,
  Bike: 60,
  Drive: 150,
});

function buildCoverageEnvelope(query) {
  const mode = query?.travelMode;
  const minutes = Number(query?.maxMinutes);
  const maxKmh = MODE_MAX_STRAIGHT_LINE_KMH[mode];

  if (!maxKmh) {
    const error = new Error('coverage_geometry_invalid_travel_mode');
    error.code = 'coverage_geometry_invalid_travel_mode';
    throw error;
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) {
    const error = new Error('coverage_geometry_unsupported_minutes');
    error.code = 'coverage_geometry_unsupported_minutes';
    throw error;
  }

  const radiusMeters = Math.ceil((maxKmh * 1000 * minutes) / 60);
  if (radiusMeters > MAX_GOOGLE_CIRCLE_RADIUS_METERS) {
    const error = new Error('coverage_geometry_exceeds_provider_limit');
    error.code = 'coverage_geometry_exceeds_provider_limit';
    throw error;
  }

  return Object.freeze({
    version: GEOMETRY_CONTRACT_VERSION,
    travelMode: mode,
    maxMinutes: minutes,
    maxStraightLineKmh: maxKmh,
    radiusMeters,
    providerCircleLimitMeters: MAX_GOOGLE_CIRCLE_RADIUS_METERS,
  });
}

module.exports = {
  GEOMETRY_CONTRACT_VERSION,
  MAX_GOOGLE_CIRCLE_RADIUS_METERS,
  MAX_MINUTES,
  MODE_MAX_STRAIGHT_LINE_KMH,
  buildCoverageEnvelope,
};
