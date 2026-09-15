'use strict';

const {
  COMPLETE_TOP_K,
  DEGRADED,
  RANKING_MODE,
  DEFAULT_RATING_THRESHOLDS,
  PRICE_LEVELS_ASC,
  candidateComparator,
  durationSecondsFromRouteResult,
  uniquePlaceIds,
  validateThresholds,
} = require('./topKProofPlanner');

function validateCommon({ polygon, includedTypes, aggregateSearch, routeMatrixCompute, k, maxRouteCalls }) {
  if (!Array.isArray(polygon) || polygon.length < 4) throw new Error('polygon_required');
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw new Error('included_types_required');
  if (typeof aggregateSearch !== 'function') throw new Error('aggregate_search_required');
  if (typeof routeMatrixCompute !== 'function') throw new Error('route_matrix_compute_required');
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('invalid_top_k');
  if (!Number.isInteger(maxRouteCalls) || maxRouteCalls < k) throw new Error('invalid_max_route_calls');
}

async function materialize({ aggregateSearch, polygon, includedTypes, expectedCount, ratingFilter = null, priceLevels = null, operatingStatus }) {
  const result = await aggregateSearch({
    polygon,
    includedTypes,
    includePlaceIds: true,
    ratingFilter,
    priceLevels,
    operatingStatus,
  });
  const count = Number(result?.count);
  const placeIds = uniquePlaceIds(result?.placeIds ?? result?.placeInsights?.map((entry) => entry?.place));
  return { valid: count === expectedCount && placeIds.length === expectedCount, placeIds };
}

async function exactTravelFilter({
  placeIds,
  routeMatrixCompute,
  maxMinutes,
  routeCache,
  routeState,
  maxRouteCalls,
  stopAfterQualified = null,
}) {
  const qualified = [];
  const orderedPlaceIds = [...placeIds];
  if (stopAfterQualified != null) orderedPlaceIds.sort((a, b) => a.localeCompare(b));

  for (const placeId of orderedPlaceIds) {
    let cached = routeCache.get(placeId);
    if (!cached) {
      if (routeState.calls >= maxRouteCalls) {
        return { ok: false, reason: 'hard_travel_route_call_budget_exhausted', qualified: [], exhausted: false };
      }
      try {
        const route = await routeMatrixCompute({ placeId });
        cached = { route, seconds: durationSecondsFromRouteResult(route) };
      } catch (error) {
        return { ok: false, reason: error?.message || 'hard_travel_route_failed', qualified: [], exhausted: false };
      }
      routeState.calls += 1;
      routeCache.set(placeId, cached);
    }
    if (cached.seconds <= Number(maxMinutes) * 60) {
      qualified.push({ placeId, travelTimeSeconds: cached.seconds, route: cached.route });
      if (stopAfterQualified != null && qualified.length >= stopAfterQualified) {
        return { ok: true, qualified, exhausted: false };
      }
    }
  }
  return { ok: true, qualified, exhausted: true };
}

async function proveRatingTopKWithHardTravel({
  polygon,
  includedTypes,
  aggregateSearch,
  placeDetails,
  routeMatrixCompute,
  maxMinutes,
  k = 10,
  maxCandidateDetails = 100,
  maxRouteCalls = 100,
  ratingThresholds = DEFAULT_RATING_THRESHOLDS,
  priceLevels = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  validateCommon({ polygon, includedTypes, aggregateSearch, routeMatrixCompute, k, maxRouteCalls });
  if (typeof placeDetails !== 'function') throw new Error('place_details_required');
  if (!Number.isInteger(maxCandidateDetails) || maxCandidateDetails < k || maxCandidateDetails > 100) throw new Error('invalid_max_candidate_details');
  if (!Number.isFinite(Number(maxMinutes)) || Number(maxMinutes) <= 0) throw new Error('invalid_max_minutes');

  const thresholds = validateThresholds(ratingThresholds);
  const routeCache = new Map();
  const routeState = { calls: 0 };
  const diagnostics = [];
  let aggregateCalls = 0;
  let detailCalls = 0;

  for (const minRating of thresholds) {
    const counted = await aggregateSearch({
      polygon, includedTypes, includePlaceIds: false,
      ratingFilter: { minRating, maxRating: 5 }, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(counted?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'invalid_aggregate_count', topK: [], aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.push({ minRating, count });
    if (count < k && minRating !== 1) continue;
    if (count > maxCandidateDetails) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_candidate_cap_exceeded', topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
    }
    if (count === 0) {
      return {
        status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null, topK: [], candidateCount: 0,
        exactQualifiedCount: 0, selectedThreshold: minRating, aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics,
        proof: { ranking: 'RATING_DESC', hardTravelConstraint: true, k, complete: true, fewerThanKAvailable: true },
      };
    }

    const materialized = await materialize({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter: { minRating, maxRating: 5 }, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_candidate_materialization_incomplete', topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
    }

    // All 5.0 candidates are equivalent on the user-selected ranking criterion.
    // Route them in deterministic Place-ID order and stop as soon as K verified
    // in-time winners exist. Routing the rest cannot change a valid Top-K set.
    if (minRating === 5) {
      const travel = await exactTravelFilter({
        placeIds: materialized.placeIds,
        routeMatrixCompute,
        maxMinutes,
        routeCache,
        routeState,
        maxRouteCalls,
        stopAfterQualified: k,
      });
      if (!travel.ok) {
        return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: travel.reason, topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
      }
      diagnostics.at(-1).exactWithinMaxMinutes = travel.qualified.length;
      diagnostics.at(-1).routeProofExhausted = travel.exhausted;
      if (travel.qualified.length >= k) {
        const topK = travel.qualified.map((candidate) => ({ ...candidate, rating: 5, userRatingCount: null, details: null }));
        return {
          status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null, topK,
          candidateCount: count, exactQualifiedCount: travel.qualified.length, selectedThreshold: minRating,
          aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics,
          proof: {
            ranking: 'RATING_DESC', tiePolicy: 'RATING_TIES_EQUIVALENT', deterministicSelection: 'PLACE_ID_ASC',
            hardTravelConstraint: true, maxMinutes: Number(maxMinutes), k, complete: true,
            fewerThanKAvailable: false, excludedBelowRating: minRating,
            routeProofExhausted: travel.exhausted,
          },
        };
      }
      // Fewer than K 5.0 places survived exact travel. Because the limited
      // filter exhausted this set, it is safe to continue to the next rating
      // threshold while reusing every route already paid for.
      if (minRating !== 1) continue;
    }

    const travel = await exactTravelFilter({
      placeIds: materialized.placeIds, routeMatrixCompute, maxMinutes, routeCache, routeState, maxRouteCalls,
    });
    if (!travel.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: travel.reason, topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.at(-1).exactWithinMaxMinutes = travel.qualified.length;
    diagnostics.at(-1).routeProofExhausted = true;
    if (travel.qualified.length < k && minRating !== 1) continue;

    const candidates = [];
    for (const routed of travel.qualified) {
      const details = await placeDetails({ placeId: routed.placeId });
      detailCalls += 1;
      const rating = Number(details?.rating);
      const userRatingCount = Number(details?.userRatingCount ?? 0);
      if (!Number.isFinite(rating) || rating < minRating || rating > 5) {
        return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_rating_filter_contract_mismatch', topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
      }
      candidates.push({
        ...routed,
        rating,
        userRatingCount: Number.isFinite(userRatingCount) && userRatingCount >= 0 ? userRatingCount : 0,
        details,
      });
    }
    candidates.sort(candidateComparator);
    return {
      status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null, topK: candidates.slice(0, k),
      candidateCount: count, exactQualifiedCount: candidates.length, selectedThreshold: minRating,
      aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics,
      proof: {
        ranking: 'RATING_DESC', tieBreak: ['USER_RATING_COUNT_DESC', 'PLACE_ID_ASC'],
        hardTravelConstraint: true, maxMinutes: Number(maxMinutes), k, complete: true,
        fewerThanKAvailable: candidates.length < k, excludedBelowRating: minRating,
      },
    };
  }

  return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'rating_hard_travel_proof_incomplete', topK: [], aggregateCalls, detailCalls, routeCalls: routeState.calls, diagnostics };
}

async function provePriceTopKWithHardTravel({
  polygon,
  includedTypes,
  aggregateSearch,
  routeMatrixCompute,
  maxMinutes,
  k = 10,
  maxCandidatesPerPriceBucket = 100,
  maxRouteCalls = 500,
  priceLevels = PRICE_LEVELS_ASC,
  ratingFilter = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  validateCommon({ polygon, includedTypes, aggregateSearch, routeMatrixCompute, k, maxRouteCalls });
  if (!Number.isFinite(Number(maxMinutes)) || Number(maxMinutes) <= 0) throw new Error('invalid_max_minutes');
  if (!Number.isInteger(maxCandidatesPerPriceBucket) || maxCandidatesPerPriceBucket < k || maxCandidatesPerPriceBucket > 100) throw new Error('invalid_max_price_bucket_candidates');

  const routeCache = new Map();
  const routeState = { calls: 0 };
  const diagnostics = [];
  const ranked = [];
  let aggregateCalls = 0;

  for (let priceRank = 0; priceRank < priceLevels.length; priceRank += 1) {
    const priceLevel = priceLevels[priceRank];
    const counted = await aggregateSearch({
      polygon, includedTypes, includePlaceIds: false, ratingFilter, priceLevels: [priceLevel], operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(counted?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'invalid_aggregate_count', topK: [], aggregateCalls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.push({ priceLevel, count });
    if (count === 0) continue;
    if (count > maxCandidatesPerPriceBucket) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'price_bucket_candidate_cap_exceeded', topK: [], priceLevel, candidateCount: count, aggregateCalls, routeCalls: routeState.calls, diagnostics };
    }

    const materialized = await materialize({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter, priceLevels: [priceLevel], operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'price_bucket_materialization_incomplete', topK: [], priceLevel, candidateCount: count, aggregateCalls, routeCalls: routeState.calls, diagnostics };
    }

    // Every candidate in this bucket is equivalent on PRICE. Verify only as
    // many deterministic IDs as needed to fill the remaining Top-K slots.
    // If the bucket cannot fill them, the helper exhausts the bucket and the
    // next price level is required. This never weakens completeness.
    const needed = Math.max(0, k - ranked.length);
    const travel = await exactTravelFilter({
      placeIds: materialized.placeIds,
      routeMatrixCompute,
      maxMinutes,
      routeCache,
      routeState,
      maxRouteCalls,
      stopAfterQualified: needed,
    });
    if (!travel.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: travel.reason, topK: [], priceLevel, candidateCount: count, aggregateCalls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.at(-1).exactWithinMaxMinutes = travel.qualified.length;
    diagnostics.at(-1).routeProofExhausted = travel.exhausted;
    ranked.push(...travel.qualified.map((candidate) => ({ ...candidate, priceLevel, priceRank })));
    if (ranked.length >= k) break;
  }

  return {
    status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.PRICE, reason: null, topK: ranked.slice(0, k),
    candidateCount: ranked.length, exactQualifiedCount: ranked.length, aggregateCalls, detailCalls: 0,
    routeCalls: routeState.calls, diagnostics,
    proof: {
      ranking: 'PRICE_ASC', tiePolicy: 'SAME_PRICE_LEVEL_EQUIVALENT', deterministicSelection: 'PLACE_ID_ASC',
      unknownPricePolicy: 'EXCLUDED_FROM_PRICE_RANKING', hardTravelConstraint: true,
      maxMinutes: Number(maxMinutes), k, complete: true, fewerThanKAvailable: ranked.length < k,
    },
  };
}

module.exports = {
  provePriceTopKWithHardTravel,
  proveRatingTopKWithHardTravel,
};
