'use strict';

const {
  AGGREGATE_MIN_AREA_SQUARE_METERS,
  normalizeRing,
  ringAreaSquareMeters,
  splitRingForAggregate,
} = require('./polygonPartition');

const DEFAULTS = Object.freeze({
  maxIdsPerPolygon: 100,
  maxDepth: 8,
  maxAggregateCalls: 64,
  minimumAreaSquareMeters: AGGREGATE_MIN_AREA_SQUARE_METERS,
});

function normalizePlaceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('places/') ? trimmed.slice('places/'.length) : trimmed;
}

function uniqueIds(values) {
  const set = new Set();
  for (const value of values || []) {
    const id = normalizePlaceId(value?.place ?? value?.id ?? value?.name ?? value);
    if (id) set.add(id);
  }
  return [...set];
}

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function assertOptions(options) {
  const maxIdsPerPolygon = Number(options.maxIdsPerPolygon);
  const maxDepth = Number(options.maxDepth);
  const maxAggregateCalls = Number(options.maxAggregateCalls);
  const minimumAreaSquareMeters = Number(options.minimumAreaSquareMeters);

  if (!Number.isInteger(maxIdsPerPolygon) || maxIdsPerPolygon <= 0 || maxIdsPerPolygon > 100) {
    throw makeError('invalid_max_ids_per_polygon');
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw makeError('invalid_max_depth');
  if (!Number.isInteger(maxAggregateCalls) || maxAggregateCalls <= 0) throw makeError('invalid_max_aggregate_calls');
  if (!Number.isFinite(minimumAreaSquareMeters) || minimumAreaSquareMeters <= 0) {
    throw makeError('invalid_minimum_area_square_meters');
  }
}

async function enumeratePolygonCandidates({
  rootRing,
  includedTypes,
  aggregateSearch,
  searchKey,
  options: overrides = {},
}) {
  if (typeof aggregateSearch !== 'function') throw makeError('aggregate_search_required');
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw makeError('included_types_required');
  if (typeof searchKey !== 'string' || searchKey.length < 8) throw makeError('invalid_search_key');

  const options = { ...DEFAULTS, ...overrides };
  assertOptions(options);

  const ring = normalizeRing(rootRing);
  const rootAreaSquareMeters = ringAreaSquareMeters(ring);
  if (rootAreaSquareMeters < options.minimumAreaSquareMeters) {
    return {
      verified: false,
      reason: 'aggregate_polygon_below_minimum_area',
      rootCount: null,
      placeIds: [],
      aggregateCalls: 0,
      leafCount: 0,
      rootAreaSquareMeters,
    };
  }

  let aggregateCalls = 0;
  let rootCount = null;
  let leafCount = 0;
  const ids = new Set();

  async function callAggregate(args) {
    if (aggregateCalls >= options.maxAggregateCalls) throw makeError('aggregate_call_budget_exhausted');
    aggregateCalls += 1;
    return aggregateSearch(args);
  }

  async function visit(currentRing, depth, ordinal, isRoot = false) {
    const countStepKey = `${searchKey}:polygon-count:d${depth}:n${ordinal}`;
    const countPayload = await callAggregate({
      polygon: currentRing,
      includedTypes,
      includePlaceIds: false,
      stepKey: countStepKey,
    });
    const count = Number(countPayload?.count);
    if (!Number.isInteger(count) || count < 0) throw makeError('invalid_aggregate_count');
    if (isRoot) rootCount = count;

    if (count === 0) {
      leafCount += 1;
      return;
    }

    if (count <= options.maxIdsPerPolygon) {
      const idsStepKey = `${searchKey}:polygon-places:d${depth}:n${ordinal}`;
      const idsPayload = await callAggregate({
        polygon: currentRing,
        includedTypes,
        includePlaceIds: true,
        stepKey: idsStepKey,
      });
      const returnedCount = Number(idsPayload?.count ?? count);
      const returnedIds = uniqueIds(idsPayload?.placeIds ?? idsPayload?.places ?? idsPayload?.placeInsights);
      if (returnedCount !== count || returnedIds.length !== count) {
        throw makeError('aggregate_place_ids_incomplete');
      }
      for (const id of returnedIds) ids.add(id);
      leafCount += 1;
      return;
    }

    if (depth >= options.maxDepth) throw makeError('aggregate_partition_depth_exhausted');

    const split = splitRingForAggregate(currentRing, {
      minimumAreaSquareMeters: options.minimumAreaSquareMeters,
    });
    if (!split.allowed) throw makeError(split.reason || 'aggregate_polygon_split_rejected');
    if (!Array.isArray(split.parts) || split.parts.length < 2) throw makeError('aggregate_polygon_split_invalid');

    let childOrdinal = ordinal * 10;
    for (const part of split.parts) {
      childOrdinal += 1;
      await visit(part, depth + 1, childOrdinal, false);
    }
  }

  try {
    await visit(ring, 0, 0, true);
  } catch (error) {
    return {
      verified: false,
      reason: error?.code || error?.message || 'aggregate_polygon_enumeration_failed',
      rootCount,
      placeIds: [...ids],
      aggregateCalls,
      leafCount,
      rootAreaSquareMeters,
    };
  }

  const placeIds = [...ids];
  if (rootCount !== placeIds.length) {
    return {
      verified: false,
      reason: 'aggregate_partition_candidate_count_mismatch',
      rootCount,
      placeIds,
      aggregateCalls,
      leafCount,
      rootAreaSquareMeters,
    };
  }

  return {
    verified: true,
    reason: null,
    rootCount,
    placeIds,
    aggregateCalls,
    leafCount,
    rootAreaSquareMeters,
  };
}

module.exports = {
  DEFAULTS,
  enumeratePolygonCandidates,
  normalizePlaceId,
  uniqueIds,
};
