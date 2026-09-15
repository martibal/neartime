'use strict';

const {
  COMPLETE_TOP_K,
  DEGRADED,
  RANKING_MODE,
  DEFAULT_RATING_THRESHOLDS,
  PRICE_LEVELS_ASC,
  DEFAULT_TRAVEL_THRESHOLDS,
  buildTravelThresholds,
  candidateComparator,
  durationSecondsFromRouteResult,
  uniquePlaceIds,
  validateThresholds,
} = require('./topKProofPlanner');

function toLonLatRing(points) {
  if (!Array.isArray(points) || points.length < 4) throw new Error('minimum_reviews_polygon_required');
  return points.map((point) => Array.isArray(point)
    ? [Number(point[0]), Number(point[1])]
    : [Number(point?.longitude), Number(point?.latitude)]);
}

function validateMinimumReviews(value) {
  const minimumReviews = Number(value);
  if (!Number.isInteger(minimumReviews) || minimumReviews <= 0) throw new Error('invalid_minimum_reviews');
  return minimumReviews;
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

async function loadDetails({ placeIds, placeDetails, detailCache, detailState, maxDetailCalls }) {
  const detailed = [];
  for (const placeId of placeIds) {
    let details = detailCache.get(placeId);
    if (!details) {
      if (detailState.calls >= maxDetailCalls) {
        return { ok: false, reason: 'minimum_reviews_detail_budget_exhausted', detailed: [] };
      }
      try {
        details = await placeDetails({ placeId });
      } catch (error) {
        return { ok: false, reason: error?.message || 'minimum_reviews_place_details_failed', detailed: [] };
      }
      detailState.calls += 1;
      detailCache.set(placeId, details);
    }
    const userRatingCount = Number(details?.userRatingCount ?? 0);
    detailed.push({
      placeId,
      details,
      userRatingCount: Number.isFinite(userRatingCount) && userRatingCount >= 0 ? userRatingCount : 0,
    });
  }
  return { ok: true, detailed };
}

async function exactTravelFilter({ candidates, routeMatrixCompute, maxSeconds, routeCache, routeState, maxRouteCalls }) {
  const qualified = [];
  for (const candidate of candidates) {
    let cached = routeCache.get(candidate.placeId);
    if (!cached) {
      if (routeState.calls >= maxRouteCalls) {
        return { ok: false, reason: 'minimum_reviews_route_budget_exhausted', qualified: [] };
      }
      try {
        const route = await routeMatrixCompute({ placeId: candidate.placeId });
        cached = { route, seconds: durationSecondsFromRouteResult(route) };
      } catch (error) {
        return { ok: false, reason: error?.message || 'minimum_reviews_route_failed', qualified: [] };
      }
      routeState.calls += 1;
      routeCache.set(candidate.placeId, cached);
    }
    if (cached.seconds <= maxSeconds) {
      qualified.push({ ...candidate, route: cached.route, travelTimeSeconds: cached.seconds });
    }
  }
  return { ok: true, qualified };
}

function reviewedCandidates(detailed, minimumReviews) {
  return detailed.filter((candidate) => candidate.userRatingCount >= minimumReviews);
}

async function proveRatingTopKWithMinimumReviews({
  polygon,
  includedTypes,
  aggregateSearch,
  placeDetails,
  routeMatrixCompute,
  maxMinutes,
  minimumReviews,
  k = 20,
  maxDetailCalls = 100,
  maxRouteCalls = 100,
  ratingThresholds = DEFAULT_RATING_THRESHOLDS,
  priceLevels = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  validateMinimumReviews(minimumReviews);
  const thresholds = validateThresholds(ratingThresholds);
  const detailCache = new Map();
  const routeCache = new Map();
  const detailState = { calls: 0 };
  const routeState = { calls: 0 };
  const diagnostics = [];
  let aggregateCalls = 0;

  for (const minRating of thresholds) {
    const counted = await aggregateSearch({
      polygon, includedTypes, includePlaceIds: false,
      ratingFilter: { minRating, maxRating: 5 }, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(counted?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'invalid_aggregate_count', topK: [], aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.push({ minRating, count });
    if (count < k && minRating !== 1) continue;
    if (count > 100) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'minimum_reviews_candidate_cap_exceeded', topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    if (count === 0) {
      return {
        status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null, topK: [], candidateCount: 0,
        selectedThreshold: minRating, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics,
        proof: { ranking: 'RATING_DESC', hardTravelConstraint: true, minimumReviews, k, complete: true, fewerThanKAvailable: true },
      };
    }

    const materialized = await materialize({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter: { minRating, maxRating: 5 }, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'minimum_reviews_candidate_materialization_incomplete', topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }

    const loaded = await loadDetails({ placeIds: materialized.placeIds, placeDetails, detailCache, detailState, maxDetailCalls });
    if (!loaded.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: loaded.reason, topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    const reviewed = reviewedCandidates(loaded.detailed, minimumReviews);
    diagnostics.at(-1).reviewQualifiedCount = reviewed.length;

    const ratingCandidates = [];
    for (const candidate of reviewed) {
      const rating = Number(candidate.details?.rating);
      if (!Number.isFinite(rating) || rating < minRating || rating > 5) {
        return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_rating_filter_contract_mismatch', topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
      }
      ratingCandidates.push({ ...candidate, rating });
    }

    const travel = await exactTravelFilter({
      candidates: ratingCandidates,
      routeMatrixCompute,
      maxSeconds: Number(maxMinutes) * 60,
      routeCache,
      routeState,
      maxRouteCalls,
    });
    if (!travel.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: travel.reason, topK: [], candidateCount: count, selectedThreshold: minRating, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.at(-1).exactWithinMaxMinutes = travel.qualified.length;
    if (travel.qualified.length < k && minRating !== 1) continue;

    travel.qualified.sort(candidateComparator);
    return {
      status: COMPLETE_TOP_K,
      rankingMode: RANKING_MODE.RATING,
      reason: null,
      topK: travel.qualified.slice(0, k),
      candidateCount: count,
      exactQualifiedCount: travel.qualified.length,
      selectedThreshold: minRating,
      aggregateCalls,
      detailCalls: detailState.calls,
      routeCalls: routeState.calls,
      diagnostics,
      proof: {
        ranking: 'RATING_DESC', tieBreak: ['USER_RATING_COUNT_DESC', 'PLACE_ID_ASC'],
        minimumReviews, hardTravelConstraint: true, maxMinutes: Number(maxMinutes),
        k, complete: true, fewerThanKAvailable: travel.qualified.length < k,
      },
    };
  }

  return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'minimum_reviews_rating_proof_incomplete', topK: [], aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
}

async function provePriceTopKWithMinimumReviews({
  polygon,
  includedTypes,
  aggregateSearch,
  placeDetails,
  routeMatrixCompute,
  maxMinutes,
  minimumReviews,
  k = 20,
  maxDetailCalls = 100,
  maxRouteCalls = 100,
  priceLevels = PRICE_LEVELS_ASC,
  ratingFilter = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  validateMinimumReviews(minimumReviews);
  const detailCache = new Map();
  const routeCache = new Map();
  const detailState = { calls: 0 };
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
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'invalid_aggregate_count', topK: [], aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.push({ priceLevel, count });
    if (count === 0) continue;
    if (count > 100) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'minimum_reviews_price_bucket_candidate_cap_exceeded', topK: [], priceLevel, candidateCount: count, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }

    const materialized = await materialize({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter, priceLevels: [priceLevel], operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'minimum_reviews_price_bucket_materialization_incomplete', topK: [], priceLevel, candidateCount: count, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }

    const loaded = await loadDetails({ placeIds: materialized.placeIds, placeDetails, detailCache, detailState, maxDetailCalls });
    if (!loaded.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: loaded.reason, topK: [], priceLevel, candidateCount: count, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    const reviewed = reviewedCandidates(loaded.detailed, minimumReviews);
    diagnostics.at(-1).reviewQualifiedCount = reviewed.length;

    const travel = await exactTravelFilter({
      candidates: reviewed,
      routeMatrixCompute,
      maxSeconds: Number(maxMinutes) * 60,
      routeCache,
      routeState,
      maxRouteCalls,
    });
    if (!travel.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: travel.reason, topK: [], priceLevel, candidateCount: count, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.at(-1).exactWithinMaxMinutes = travel.qualified.length;
    ranked.push(...travel.qualified
      .sort((a, b) => a.placeId.localeCompare(b.placeId))
      .map((candidate) => ({ ...candidate, priceLevel, priceRank })));
    if (ranked.length >= k) break;
  }

  return {
    status: COMPLETE_TOP_K,
    rankingMode: RANKING_MODE.PRICE,
    reason: null,
    topK: ranked.slice(0, k),
    candidateCount: ranked.length,
    exactQualifiedCount: ranked.length,
    aggregateCalls,
    detailCalls: detailState.calls,
    routeCalls: routeState.calls,
    diagnostics,
    proof: {
      ranking: 'PRICE_ASC', tiePolicy: 'SAME_PRICE_LEVEL_EQUIVALENT', deterministicSelection: 'PLACE_ID_ASC',
      unknownPricePolicy: 'EXCLUDED_FROM_PRICE_RANKING', minimumReviews,
      hardTravelConstraint: true, maxMinutes: Number(maxMinutes), k, complete: true,
      fewerThanKAvailable: ranked.length < k,
    },
  };
}

async function proveTravelTimeTopKWithMinimumReviews({
  envelopeProvider,
  aggregateSearch,
  placeDetails,
  routeMatrixCompute,
  origin,
  travelMode,
  maxMinutes,
  includedTypes,
  minimumReviews,
  k = 20,
  maxDetailCalls = 100,
  maxRouteCalls = 100,
  travelThresholds = DEFAULT_TRAVEL_THRESHOLDS,
  ratingFilter = null,
  priceLevels = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  validateMinimumReviews(minimumReviews);
  const thresholds = buildTravelThresholds(maxMinutes, travelThresholds);
  const detailCache = new Map();
  const routeCache = new Map();
  const detailState = { calls: 0 };
  const routeState = { calls: 0 };
  const diagnostics = [];
  let envelopeCalls = 0;
  let aggregateCalls = 0;

  for (const thresholdMinutes of thresholds) {
    const envelope = await envelopeProvider.getEnvelope({ origin, travelMode, maxMinutes: thresholdMinutes });
    envelopeCalls += 1;
    if (Number(envelope?.discardedHoleCount || 0) > 0 || Number(envelope?.polygonCount) !== 1 || !Array.isArray(envelope?.polygons?.[0])) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'travel_time_envelope_not_simple_exact', topK: [], thresholdMinutes, envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    const polygon = toLonLatRing(envelope.polygons[0]);
    const counted = await aggregateSearch({
      polygon, includedTypes, includePlaceIds: false, ratingFilter, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(counted?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'invalid_aggregate_count', topK: [], envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.push({ thresholdMinutes, count });
    const atMax = thresholdMinutes === Number(maxMinutes);
    if (count < k && !atMax) continue;
    if (count > 100) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'minimum_reviews_travel_candidate_cap_exceeded', topK: [], thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }

    const materialized = await materialize({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'minimum_reviews_travel_materialization_incomplete', topK: [], thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }

    const loaded = await loadDetails({ placeIds: materialized.placeIds, placeDetails, detailCache, detailState, maxDetailCalls });
    if (!loaded.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: loaded.reason, topK: [], thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    const reviewed = reviewedCandidates(loaded.detailed, minimumReviews);
    diagnostics.at(-1).reviewQualifiedCount = reviewed.length;

    const travel = await exactTravelFilter({
      candidates: reviewed,
      routeMatrixCompute,
      maxSeconds: thresholdMinutes * 60,
      routeCache,
      routeState,
      maxRouteCalls,
    });
    if (!travel.ok) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: travel.reason, topK: [], thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
    }
    diagnostics.at(-1).exactWithinThreshold = travel.qualified.length;
    travel.qualified.sort((a, b) => a.travelTimeSeconds - b.travelTimeSeconds || a.placeId.localeCompare(b.placeId));
    if (travel.qualified.length >= k || atMax) {
      return {
        status: COMPLETE_TOP_K,
        rankingMode: RANKING_MODE.TRAVEL_TIME,
        reason: null,
        topK: travel.qualified.slice(0, k),
        candidateCount: count,
        exactQualifiedCount: travel.qualified.length,
        selectedThresholdMinutes: thresholdMinutes,
        envelopeCalls,
        aggregateCalls,
        detailCalls: detailState.calls,
        routeCalls: routeState.calls,
        diagnostics,
        proof: {
          ranking: 'TRAVEL_TIME_ASC', tieBreak: ['PLACE_ID_ASC'], minimumReviews,
          k, complete: true, fewerThanKAvailable: travel.qualified.length < k,
          maxMinutes: Number(maxMinutes),
        },
      };
    }
  }

  return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'minimum_reviews_travel_proof_incomplete', topK: [], envelopeCalls, aggregateCalls, detailCalls: detailState.calls, routeCalls: routeState.calls, diagnostics };
}

module.exports = {
  provePriceTopKWithMinimumReviews,
  proveRatingTopKWithMinimumReviews,
  proveTravelTimeTopKWithMinimumReviews,
};
