'use strict';

// Coverage geometry is only a candidate-acquisition boundary. It must never invent
// travel speed or ETA. NearTime's time filter is authoritative only when it comes
// from Google Routes / routing summaries for the selected travel mode.
//
// v2 therefore refuses to derive a radius from km/h. A future geometry resolver
// must supply a Google-Routes-derived acquisition bound explicitly. Until then the
// coverage-v2 endpoint remains fail-closed, even if its environment flags are set.
const GEOMETRY_CONTRACT_VERSION = 'coverage-geometry-v2-google-route-authority';
const MAX_MINUTES = 20;
const MAX_GOOGLE_CIRCLE_RADIUS_METERS = 50000;
const ROUTE_BOUND_SOURCE = 'google-routes-derived';

function coverageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function buildCoverageEnvelope(query, routeBound = null) {
  const mode = query?.travelMode;
  const minutes = Number(query?.maxMinutes);

  if (!['Walk', 'Bike', 'Drive'].includes(mode)) {
    throw coverageError('coverage_geometry_invalid_travel_mode');
  }
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) {
    throw coverageError('coverage_geometry_unsupported_minutes');
  }

  if (!routeBound || routeBound.source !== ROUTE_BOUND_SOURCE) {
    throw coverageError('coverage_geometry_route_bound_required');
  }
  if (routeBound.travelMode !== mode || Number(routeBound.maxMinutes) !== minutes) {
    throw coverageError('coverage_geometry_route_bound_mismatch');
  }

  const radiusMeters = Number(routeBound.radiusMeters);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw coverageError('coverage_geometry_invalid_route_bound');
  }
  if (radiusMeters > MAX_GOOGLE_CIRCLE_RADIUS_METERS) {
    throw coverageError('coverage_geometry_exceeds_provider_limit');
  }

  return Object.freeze({
    version: GEOMETRY_CONTRACT_VERSION,
    authority: 'google-routes',
    source: ROUTE_BOUND_SOURCE,
    travelMode: mode,
    maxMinutes: minutes,
    radiusMeters: Math.ceil(radiusMeters),
    providerCircleLimitMeters: MAX_GOOGLE_CIRCLE_RADIUS_METERS,
  });
}

module.exports = {
  GEOMETRY_CONTRACT_VERSION,
  MAX_GOOGLE_CIRCLE_RADIUS_METERS,
  MAX_MINUTES,
  ROUTE_BOUND_SOURCE,
  buildCoverageEnvelope,
};
