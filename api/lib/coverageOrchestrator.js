'use strict';

const {
  retrievalCostMicroUsd,
  shouldEscalateNearby,
} = require('./retrievalCostPlanner');

const DEFAULTS = Object.freeze({
  leafTarget: 20,
  maxDepth: 5,
  maxAggregateCalls: 48,
  maxNearbyCalls: 32,
  maxFallbackCalls: 64,
  adaptiveNearbyStageCalls: 0,
});

const RESULT_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  DEGRADED: 'DEGRADED',
  NO_MATCHES: 'NO_MATCHES',
});

const COVERAGE_STATE = Object.freeze({
  VERIFIED_CURRENT: 'VERIFIED_CURRENT',
  CACHED_CANDIDATES: 'CACHED_CANDIDATES',
  UNVERIFIED: 'UNVERIFIED',
});

const SKU = Object.freeze({
  AGGREGATE: '546C-66B2-E5A6',
  NEARBY_ENTERPRISE_ATMOSPHERE: 'F20E-7034-0EF7',
  PLACE_DETAILS_ENTERPRISE: '2D9A-3DE0-3766',
});

function assertFiniteCoordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid_${name}`);
  return number;
}

function normalizePlaceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('places/') ? trimmed.slice('places/'.length) : trimmed;
}

function uniqueIds(values) {
  const seen = new Set();
  for (const value of values || []) {
    const id = normalizePlaceId(value?.place ?? value?.id ?? value);
    if (id) seen.add(id);
  }
  return [...seen];
}

function metersToLatitudeDegrees(meters) {
  return meters / 111320;
}

function metersToLongitudeDegrees(meters, latitude) {
  const cosLatitude = Math.max(0.1, Math.cos((latitude * Math.PI) / 180));
  return meters / (111320 * cosLatitude);
}

function splitCircle(circle) {
  const radius = Number(circle.radius);
  const childRadius = radius / Math.SQRT2;
  const offset = radius / 2;
  const latDelta = metersToLatitudeDegrees(offset);
  const lonDelta = metersToLongitudeDegrees(offset, circle.center.latitude);
  return [
    [-latDelta, -lonDelta],
    [-latDelta, lonDelta],
    [latDelta, -lonDelta],
    [latDelta, lonDelta],
  ].map(([dLat, dLon]) => ({
    center: {
      latitude: circle.center.latitude + dLat,
      longitude: circle.center.longitude + dLon,
    },
    radius: childRadius,
  }));
}

function makeRootCircle(origin, radiusMeters) {
  const latitude = assertFiniteCoordinate(origin?.latitude, 'latitude');
  const longitude = assertFiniteCoordinate(origin?.longitude, 'longitude');
  const radius = Number(radiusMeters);
  if (!Number.isFinite(radius) || radius <= 0 || radius > 50000) throw new Error('invalid_radius');
  return { center: { latitude, longitude }, radius };
}

function stableCellKey(circle, depth, ordinal) {
  const { latitude, longitude } = circle.center;
  return `d${depth}:n${ordinal}:${latitude.toFixed(7)}:${longitude.toFixed(7)}:${circle.radius.toFixed(2)}`;
}

function makeBudget(options) {
  return {
    aggregateCalls: 0,
    nearbyCalls: 0,
    fallbackCalls: 0,
    maxAggregateCalls: options.maxAggregateCalls,
    maxNearbyCalls: options.maxNearbyCalls,
    maxFallbackCalls: options.maxFallbackCalls,
  };
}

function requireBudget(counter, max, reason) {
  if (counter >= max) {
    const error = new Error(reason);
    error.code = reason;
    throw error;
  }
}

async function callStep(hooks, descriptor, fn) {
  const reservation = hooks?.beforeProviderCall ? await hooks.beforeProviderCall(descriptor) : null;
  try {
    const value = await fn();
    if (hooks?.afterProviderCall) await hooks.afterProviderCall({ ...descriptor, reservation, outcome: 'succeeded' });
    return value;
  } catch (error) {
    if (hooks?.afterProviderCall) await hooks.afterProviderCall({ ...descriptor, reservation, outcome: 'failed', error });
    throw error;
  }
}

async function aggregateCall({ aggregateSearch, hooks, budget, descriptor, args }) {
  requireBudget(budget.aggregateCalls, budget.maxAggregateCalls, 'aggregate_call_budget_exhausted');
  const value = await callStep(hooks, descriptor, () => aggregateSearch(args));
  budget.aggregateCalls += 1;
  return value;
}

async function enumerateLeafCells({ rootCircle, categoryTypes, aggregateSearch, hooks, options, budget, searchKey }) {
  const leaves = [];
  const queue = [{ circle: rootCircle, depth: 0, ordinal: 0 }];
  let nextOrdinal = 1;

  while (queue.length > 0) {
    const node = queue.shift();
    const cellKey = stableCellKey(node.circle, node.depth, node.ordinal);
    const countStepKey = `${searchKey}:aggregate-count:${cellKey}`;
    const countPayload = await aggregateCall({
      aggregateSearch,
      hooks,
      budget,
      descriptor: { kind: 'aggregate_count', skuId: SKU.AGGREGATE, quantity: 1, idempotencyKey: countStepKey, cellKey },
      args: { circle: node.circle, includedTypes: categoryTypes, includePlaceIds: false, stepKey: countStepKey },
    });

    const count = Number(countPayload?.count);
    if (!Number.isInteger(count) || count < 0) {
      const error = new Error('invalid_aggregate_count');
      error.code = 'invalid_aggregate_count';
      throw error;
    }

    if (count === 0) {
      leaves.push({ cellKey, circle: node.circle, depth: node.depth, count: 0, expectedIds: [] });
      continue;
    }

    if (count <= options.leafTarget) {
      const placesStepKey = `${searchKey}:aggregate-places:${cellKey}`;
      const placesPayload = await aggregateCall({
        aggregateSearch,
        hooks,
        budget,
        descriptor: { kind: 'aggregate_places', skuId: SKU.AGGREGATE, quantity: 1, idempotencyKey: placesStepKey, cellKey },
        args: { circle: node.circle, includedTypes: categoryTypes, includePlaceIds: true, stepKey: placesStepKey },
      });
      const returnedCount = Number(placesPayload?.count ?? count);
      const expectedIds = uniqueIds(placesPayload?.placeIds ?? placesPayload?.places ?? placesPayload?.placeInsights);
      leaves.push({
        cellKey,
        circle: node.circle,
        depth: node.depth,
        count,
        expectedIds,
        unverifiableReason: returnedCount !== count || expectedIds.length !== count
          ? 'aggregate_place_ids_incomplete'
          : null,
      });
      continue;
    }

    if (node.depth >= options.maxDepth) {
      leaves.push({
        cellKey,
        circle: node.circle,
        depth: node.depth,
        count,
        expectedIds: [],
        unverifiableReason: 'partition_depth_exhausted',
      });
      continue;
    }

    for (const child of splitCircle(node.circle)) {
      queue.push({ circle: child, depth: node.depth + 1, ordinal: nextOrdinal++ });
    }
  }
  return leaves;
}

async function retrieveLeaf({ leaf, categoryTypes, nearbySearch, placeDetails, hooks, budget, searchKey, options }) {
  if (leaf.count === 0) {
    return {
      verified: !leaf.unverifiableReason,
      reason: leaf.unverifiableReason || null,
      expectedIds: [],
      retrievedIds: [],
      places: [],
      economics: null,
    };
  }

  requireBudget(budget.nearbyCalls, budget.maxNearbyCalls, 'nearby_call_budget_exhausted');
  const nearbyStepKey = `${searchKey}:nearby:${leaf.cellKey}`;
  const nearby = await callStep(
    hooks,
    { kind: 'nearby', skuId: SKU.NEARBY_ENTERPRISE_ATMOSPHERE, quantity: 1, idempotencyKey: nearbyStepKey, cellKey: leaf.cellKey },
    () => nearbySearch({ circle: leaf.circle, includedTypes: categoryTypes, maxResultCount: 20, stepKey: nearbyStepKey }),
  );
  budget.nearbyCalls += 1;

  const places = Array.isArray(nearby?.places) ? nearby.places : [];
  const byId = new Map();
  for (const place of places) {
    const id = normalizePlaceId(place?.id ?? place?.name);
    if (id) byId.set(id, place);
  }

  if (leaf.unverifiableReason) {
    return {
      verified: false,
      reason: leaf.unverifiableReason,
      expectedIds: leaf.expectedIds,
      retrievedIds: [...byId.keys()],
      places: [...byId.values()],
      economics: null,
    };
  }

  const missing = leaf.expectedIds.filter((id) => !byId.has(id));
  const economics = {
    nearbyCallsAlreadySpent: 1,
    missingCount: missing.length,
    currentPathMicroUsd: retrievalCostMicroUsd({ nearbyCalls: 1, missingCount: missing.length }),
    adaptiveDecision: null,
  };

  const proposedAdaptiveCalls = Number(options.adaptiveNearbyStageCalls || 0);
  if (!Number.isInteger(proposedAdaptiveCalls) || proposedAdaptiveCalls < 0) {
    return {
      verified: false,
      reason: 'invalid_adaptive_nearby_stage_calls',
      expectedIds: leaf.expectedIds,
      retrievedIds: [...byId.keys()],
      places: [...byId.values()],
      economics,
    };
  }

  if (missing.length > 0 && proposedAdaptiveCalls > 0) {
    economics.adaptiveDecision = shouldEscalateNearby({
      missingCount: missing.length,
      additionalNearbyCalls: proposedAdaptiveCalls,
    });

    if (economics.adaptiveDecision.escalate) {
      return {
        verified: false,
        reason: 'adaptive_nearby_stage_not_implemented',
        expectedIds: leaf.expectedIds,
        retrievedIds: [...byId.keys()],
        places: [...byId.values()],
        economics,
      };
    }
  }

  for (const placeId of missing) {
    requireBudget(budget.fallbackCalls, budget.maxFallbackCalls, 'fallback_call_budget_exhausted');
    const stepKey = `${searchKey}:details:${placeId}`;
    const place = await callStep(
      hooks,
      { kind: 'details', skuId: SKU.PLACE_DETAILS_ENTERPRISE, quantity: 1, idempotencyKey: stepKey, placeId },
      () => placeDetails({ placeId, stepKey }),
    );
    budget.fallbackCalls += 1;
    const resolvedId = normalizePlaceId(place?.id ?? place?.name ?? placeId);
    if (place && resolvedId) byId.set(resolvedId, place);
  }

  const stillMissing = leaf.expectedIds.filter((id) => !byId.has(id));
  return {
    verified: stillMissing.length === 0,
    reason: stillMissing.length === 0 ? null : 'missing_place_ids_after_fallback',
    expectedIds: leaf.expectedIds,
    retrievedIds: [...byId.keys()],
    places: [...byId.values()],
    economics,
  };
}

async function runCoverageSearch({
  origin,
  radiusMeters,
  categoryTypes,
  searchKey,
  aggregateSearch,
  nearbySearch,
  placeDetails,
  applyHardFilters,
  hooks = null,
  options: overrides = {},
}) {
  if (!Array.isArray(categoryTypes) || categoryTypes.length === 0) throw new Error('invalid_category_types');
  if (typeof aggregateSearch !== 'function') throw new Error('aggregate_search_required');
  if (typeof nearbySearch !== 'function') throw new Error('nearby_search_required');
  if (typeof placeDetails !== 'function') throw new Error('place_details_required');
  if (typeof applyHardFilters !== 'function') throw new Error('hard_filter_required');
  if (typeof searchKey !== 'string' || searchKey.length < 8) throw new Error('invalid_search_key');

  const options = { ...DEFAULTS, ...overrides };
  const rootCircle = makeRootCircle(origin, radiusMeters);
  const budget = makeBudget(options);
  let leaves;

  try {
    leaves = await enumerateLeafCells({ rootCircle, categoryTypes, aggregateSearch, hooks, options, budget, searchKey });
  } catch (error) {
    return {
      resultStatus: RESULT_STATUS.DEGRADED,
      coverageState: COVERAGE_STATE.UNVERIFIED,
      coverageReason: error?.code || error?.message || 'aggregate_failed',
      places: [],
      candidateCount: 0,
      expectedCount: null,
      retrievedCount: 0,
      providerCalls: { ...budget },
      retrievalEconomics: [],
    };
  }

  const globalPlaces = new Map();
  const expectedIds = new Set();
  const coverageFailures = [];
  const retrievalEconomics = [];

  for (const leaf of leaves) {
    for (const id of leaf.expectedIds || []) expectedIds.add(id);
    try {
      const retrieval = await retrieveLeaf({ leaf, categoryTypes, nearbySearch, placeDetails, hooks, budget, searchKey, options });
      for (const place of retrieval.places) {
        const id = normalizePlaceId(place?.id ?? place?.name);
        if (id) globalPlaces.set(id, place);
      }
      if (retrieval.economics) retrievalEconomics.push({ cellKey: leaf.cellKey, ...retrieval.economics });
      if (!retrieval.verified) coverageFailures.push(`${leaf.cellKey}:${retrieval.reason}`);
    } catch (error) {
      coverageFailures.push(`${leaf.cellKey}:${error?.code || error?.message || 'retrieval_failed'}`);
    }
  }

  const candidates = [...globalPlaces.values()];
  const filtered = applyHardFilters(candidates);
  const fullyVerified = coverageFailures.length === 0 && [...expectedIds].every((id) => globalPlaces.has(id));

  if (!fullyVerified) {
    return {
      resultStatus: RESULT_STATUS.DEGRADED,
      coverageState: COVERAGE_STATE.UNVERIFIED,
      coverageReason: coverageFailures.join('|') || 'candidate_set_mismatch',
      places: filtered,
      candidateCount: candidates.length,
      expectedCount: expectedIds.size,
      retrievedCount: candidates.length,
      providerCalls: { ...budget },
      retrievalEconomics,
    };
  }

  return {
    resultStatus: filtered.length === 0 ? RESULT_STATUS.NO_MATCHES : RESULT_STATUS.COMPLETE,
    coverageState: COVERAGE_STATE.VERIFIED_CURRENT,
    coverageReason: null,
    places: filtered,
    candidateCount: candidates.length,
    expectedCount: expectedIds.size,
    retrievedCount: candidates.length,
    providerCalls: { ...budget },
    retrievalEconomics,
  };
}

module.exports = {
  COVERAGE_STATE,
  DEFAULTS,
  RESULT_STATUS,
  SKU,
  makeRootCircle,
  normalizePlaceId,
  runCoverageSearch,
  splitCircle,
  uniqueIds,
};
