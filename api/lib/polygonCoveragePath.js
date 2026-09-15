'use strict';

const { enumeratePolygonCandidates } = require('./polygonAggregateEnumerator');

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function toLonLatRing(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) throw codedError('invalid_envelope_polygon');
  return polygon.map((point) => {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw codedError('invalid_envelope_polygon_coordinate');
    return [longitude, latitude];
  });
}

async function runPolygonCoveragePath({
  envelopeProvider,
  aggregateSearch,
  origin,
  travelMode,
  maxMinutes,
  includedTypes,
  searchKey,
  enumerationOptions = {},
}) {
  if (!envelopeProvider || typeof envelopeProvider.getEnvelope !== 'function') {
    throw codedError('envelope_provider_required');
  }
  if (typeof aggregateSearch !== 'function') throw codedError('aggregate_search_required');
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw codedError('included_types_required');
  if (typeof searchKey !== 'string' || searchKey.length < 8) throw codedError('invalid_search_key');

  let envelope;
  try {
    envelope = await envelopeProvider.getEnvelope({ origin, travelMode, maxMinutes });
  } catch (error) {
    return {
      verified: false,
      reason: error?.code || error?.message || 'envelope_failed',
      envelope: null,
      placeIds: [],
      expectedCount: null,
      aggregateCalls: 0,
      polygonResults: [],
    };
  }

  if (!Array.isArray(envelope?.polygons) || envelope.polygons.length === 0) {
    return {
      verified: false,
      reason: 'envelope_has_no_polygons',
      envelope,
      placeIds: [],
      expectedCount: null,
      aggregateCalls: 0,
      polygonResults: [],
    };
  }

  // Dropping isochrone holes creates a superset. Until holes are represented exactly,
  // do not claim verified-current coverage when the source geometry contains them.
  if (Number(envelope.discardedHoleCount || 0) > 0) {
    return {
      verified: false,
      reason: 'isochrone_holes_not_supported_exactly',
      envelope,
      placeIds: [],
      expectedCount: null,
      aggregateCalls: 0,
      polygonResults: [],
    };
  }

  const globalIds = new Set();
  const polygonResults = [];
  let aggregateCalls = 0;
  let expectedCount = 0;

  for (let index = 0; index < envelope.polygons.length; index += 1) {
    const rootRing = toLonLatRing(envelope.polygons[index]);
    const result = await enumeratePolygonCandidates({
      rootRing,
      includedTypes,
      aggregateSearch,
      searchKey: `${searchKey}:poly${index}`,
      options: enumerationOptions,
    });

    polygonResults.push({ polygonIndex: index, ...result });
    aggregateCalls += Number(result.aggregateCalls || 0);

    if (!result.verified) {
      return {
        verified: false,
        reason: result.reason || 'polygon_enumeration_failed',
        envelope,
        placeIds: [...globalIds],
        expectedCount: null,
        aggregateCalls,
        polygonResults,
      };
    }

    expectedCount += Number(result.rootCount || 0);
    for (const id of result.placeIds || []) globalIds.add(id);
  }

  const placeIds = [...globalIds];

  // Distinct exterior shells should not overlap. If the same Place ID appears in
  // multiple shells, fail closed until cross-shell boundary semantics are explicit.
  if (placeIds.length !== expectedCount) {
    return {
      verified: false,
      reason: 'cross_polygon_candidate_count_mismatch',
      envelope,
      placeIds,
      expectedCount,
      aggregateCalls,
      polygonResults,
    };
  }

  return {
    verified: true,
    reason: null,
    envelope,
    placeIds,
    expectedCount,
    aggregateCalls,
    polygonResults,
  };
}

module.exports = {
  runPolygonCoveragePath,
  toLonLatRing,
};
