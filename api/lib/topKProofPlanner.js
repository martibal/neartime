'use strict';

const COMPLETE_TOP_K = 'COMPLETE_TOP_K';
const DEGRADED = 'DEGRADED';

const RANKING_MODE = Object.freeze({
  RATING: 'RATING',
  PRICE: 'PRICE',
  TRAVEL_TIME: 'TRAVEL_TIME',
});

const DEFAULT_RATING_THRESHOLDS = Object.freeze([
  5.0, 4.9, 4.8, 4.7, 4.6, 4.5, 4.4, 4.3, 4.2, 4.1, 4.0,
  3.5, 3.0, 2.5, 2.0, 1.5, 1.0,
]);

const PRICE_LEVELS_ASC = Object.freeze([
  'PRICE_LEVEL_FREE',
  'PRICE_LEVEL_INEXPENSIVE',
  'PRICE_LEVEL_MODERATE',
  'PRICE_LEVEL_EXPENSIVE',
  'PRICE_LEVEL_VERY_EXPENSIVE',
]);

const DEFAULT_TRAVEL_THRESHOLDS = Object.freeze([3, 5, 7, 10, 12, 15, 20]);

function normalizePlaceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('places/') ? trimmed.slice('places/'.length) : trimmed;
}

function uniquePlaceIds(values) {
  return [...new Set((values || []).map(normalizePlaceId).filter(Boolean))];
}

function validateTopK(k) {
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('invalid_top_k');
  return k;
}

function validateCandidateCap(value, k, errorCode) {
  if (!Number.isInteger(value) || value < k || value > 100) throw new Error(errorCode);
  return value;
}

function validateThresholds(thresholds) {
  if (!Array.isArray(thresholds) || thresholds.length === 0) throw new Error('rating_thresholds_required');
  const normalized = thresholds.map(Number);
  if (normalized.some((value) => !Number.isFinite(value) || value < 1 || value > 5)) {
    throw new Error('invalid_rating_threshold');
  }
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index] >= normalized[index - 1]) throw new Error('rating_thresholds_must_descend');
  }
  if (normalized.at(-1) !== 1) throw new Error('rating_thresholds_must_end_at_one');
  return normalized;
}

function candidateComparator(a, b) {
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (b.userRatingCount !== a.userRatingCount) return b.userRatingCount - a.userRatingCount;
  return a.placeId.localeCompare(b.placeId);
}

function exactFiveStarTopK(placeIds, k) {
  return [...placeIds]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, k)
    .map((placeId) => ({ placeId, rating: 5, userRatingCount: null, details: null }));
}

function durationSecondsFromRouteResult(result) {
  const raw = result?.routingSummary?.legs?.[0]?.duration ?? result?.duration;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw !== 'string') throw new Error('route_duration_missing');
  const match = raw.trim().match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) throw new Error('invalid_route_duration');
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('invalid_route_duration');
  return seconds;
}

function toLonLatRing(points) {
  if (!Array.isArray(points) || points.length < 4) throw new Error('travel_time_polygon_required');
  return points.map((point) => {
    if (Array.isArray(point)) return [Number(point[0]), Number(point[1])];
    return [Number(point?.longitude), Number(point?.latitude)];
  });
}

function buildTravelThresholds(maxMinutes, configured = DEFAULT_TRAVEL_THRESHOLDS) {
  const max = Number(maxMinutes);
  if (!Number.isFinite(max) || max <= 0 || max > 20) throw new Error('invalid_max_minutes');
  const values = [...new Set(configured.map(Number).filter((value) => Number.isFinite(value) && value > 0 && value < max))]
    .sort((a, b) => a - b);
  values.push(max);
  return values;
}

async function materializeAggregateSet({
  aggregateSearch,
  polygon,
  includedTypes,
  expectedCount,
  ratingFilter = null,
  priceLevels = null,
  operatingStatus,
}) {
  const result = await aggregateSearch({
    polygon,
    includedTypes,
    includePlaceIds: true,
    ratingFilter,
    priceLevels,
    operatingStatus,
  });
  const materializedCount = Number(result?.count);
  const placeIds = uniquePlaceIds(result?.placeIds ?? result?.placeInsights?.map((entry) => entry?.place));
  return {
    valid: materializedCount === expectedCount && placeIds.length === expectedCount,
    count: materializedCount,
    placeIds,
  };
}

async function proveTopKByRating({
  polygon,
  includedTypes,
  aggregateSearch,
  placeDetails,
  k = 20,
  maxCandidateDetails = 100,
  ratingThresholds = DEFAULT_RATING_THRESHOLDS,
  priceLevels = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  if (!Array.isArray(polygon) || polygon.length < 4) throw new Error('polygon_required');
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw new Error('included_types_required');
  if (typeof aggregateSearch !== 'function') throw new Error('aggregate_search_required');
  if (typeof placeDetails !== 'function') throw new Error('place_details_required');
  validateTopK(k);
  validateCandidateCap(maxCandidateDetails, k, 'invalid_max_candidate_details');

  const thresholds = validateThresholds(ratingThresholds);
  let aggregateCalls = 0;
  let detailCalls = 0;
  const diagnostics = [];
  let selectedThreshold = null;
  let selectedCount = null;

  for (const minRating of thresholds) {
    const result = await aggregateSearch({
      polygon,
      includedTypes,
      includePlaceIds: false,
      ratingFilter: { minRating, maxRating: 5 },
      priceLevels,
      operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(result?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'invalid_aggregate_count', topK: [], aggregateCalls, detailCalls, diagnostics };
    }
    diagnostics.push({ minRating, count });
    if (count >= k || minRating === 1) {
      selectedThreshold = minRating;
      selectedCount = count;
      break;
    }
  }

  if (selectedThreshold == null || selectedCount == null) {
    return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'rating_threshold_proof_incomplete', topK: [], aggregateCalls, detailCalls, diagnostics };
  }
  if (selectedCount > maxCandidateDetails) {
    return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_candidate_cap_exceeded', topK: [], candidateCount: selectedCount, selectedThreshold, aggregateCalls, detailCalls, diagnostics };
  }
  if (selectedCount === 0) {
    return {
      status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null, topK: [], candidateCount: 0,
      selectedThreshold, aggregateCalls, detailCalls, diagnostics,
      proof: { ranking: 'RATING_DESC', k, complete: true, fewerThanKAvailable: true },
    };
  }

  const materialized = await materializeAggregateSet({
    aggregateSearch, polygon, includedTypes, expectedCount: selectedCount,
    ratingFilter: { minRating: selectedThreshold, maxRating: 5 }, priceLevels, operatingStatus,
  });
  aggregateCalls += 1;
  if (!materialized.valid) {
    return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_candidate_materialization_incomplete', topK: [], candidateCount: selectedCount, selectedThreshold, aggregateCalls, detailCalls, diagnostics };
  }

  if (selectedThreshold === 5) {
    return {
      status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null,
      topK: exactFiveStarTopK(materialized.placeIds, k), candidateCount: selectedCount,
      selectedThreshold, aggregateCalls, detailCalls, diagnostics,
      proof: {
        ranking: 'RATING_DESC', tiePolicy: 'RATING_TIES_EQUIVALENT', deterministicSelection: 'PLACE_ID_ASC',
        k, complete: true, fewerThanKAvailable: selectedCount < k, excludedBelowRating: selectedThreshold,
      },
    };
  }

  const candidates = [];
  for (const placeId of materialized.placeIds) {
    const details = await placeDetails({ placeId });
    detailCalls += 1;
    const rating = Number(details?.rating);
    const userRatingCount = Number(details?.userRatingCount ?? 0);
    if (!Number.isFinite(rating) || rating < selectedThreshold || rating > 5) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.RATING, reason: 'top_k_rating_filter_contract_mismatch', topK: [], candidateCount: selectedCount, selectedThreshold, aggregateCalls, detailCalls, diagnostics };
    }
    candidates.push({
      placeId,
      rating,
      userRatingCount: Number.isFinite(userRatingCount) && userRatingCount >= 0 ? userRatingCount : 0,
      details,
    });
  }
  candidates.sort(candidateComparator);
  return {
    status: COMPLETE_TOP_K, rankingMode: RANKING_MODE.RATING, reason: null, topK: candidates.slice(0, k),
    candidateCount: selectedCount, selectedThreshold, aggregateCalls, detailCalls, diagnostics,
    proof: {
      ranking: 'RATING_DESC', tieBreak: ['USER_RATING_COUNT_DESC', 'PLACE_ID_ASC'], k, complete: true,
      fewerThanKAvailable: selectedCount < k, excludedBelowRating: selectedThreshold,
    },
  };
}

async function proveTopKByPrice({
  polygon,
  includedTypes,
  aggregateSearch,
  k = 20,
  maxCandidatesPerPriceBucket = 100,
  priceLevels = PRICE_LEVELS_ASC,
  ratingFilter = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  if (!Array.isArray(polygon) || polygon.length < 4) throw new Error('polygon_required');
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw new Error('included_types_required');
  if (typeof aggregateSearch !== 'function') throw new Error('aggregate_search_required');
  validateTopK(k);
  validateCandidateCap(maxCandidatesPerPriceBucket, k, 'invalid_max_price_bucket_candidates');
  if (!Array.isArray(priceLevels) || priceLevels.length === 0) throw new Error('price_levels_required');

  let aggregateCalls = 0;
  const diagnostics = [];
  const ranked = [];

  for (let priceRank = 0; priceRank < priceLevels.length; priceRank += 1) {
    const priceLevel = priceLevels[priceRank];
    const counted = await aggregateSearch({
      polygon,
      includedTypes,
      includePlaceIds: false,
      ratingFilter,
      priceLevels: [priceLevel],
      operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(counted?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'invalid_aggregate_count', topK: [], aggregateCalls, diagnostics };
    }
    diagnostics.push({ priceLevel, count });
    if (count === 0) continue;
    if (count > maxCandidatesPerPriceBucket) {
      return {
        status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'price_bucket_candidate_cap_exceeded', topK: [],
        priceLevel, candidateCount: count, aggregateCalls, diagnostics,
      };
    }

    const materialized = await materializeAggregateSet({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter, priceLevels: [priceLevel], operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.PRICE, reason: 'price_bucket_materialization_incomplete', topK: [], priceLevel, candidateCount: count, aggregateCalls, diagnostics };
    }

    const bucket = materialized.placeIds
      .sort((a, b) => a.localeCompare(b))
      .map((placeId) => ({ placeId, priceLevel, priceRank }));
    ranked.push(...bucket);
    if (ranked.length >= k) break;
  }

  return {
    status: COMPLETE_TOP_K,
    rankingMode: RANKING_MODE.PRICE,
    reason: null,
    topK: ranked.slice(0, k),
    candidateCount: ranked.length,
    aggregateCalls,
    detailCalls: 0,
    diagnostics,
    proof: {
      ranking: 'PRICE_ASC',
      tiePolicy: 'SAME_PRICE_LEVEL_EQUIVALENT',
      deterministicSelection: 'PLACE_ID_ASC',
      unknownPricePolicy: 'EXCLUDED_FROM_PRICE_RANKING',
      k,
      complete: true,
      fewerThanKAvailable: ranked.length < k,
    },
  };
}

async function proveTopKByTravelTime({
  envelopeProvider,
  aggregateSearch,
  routeMatrixCompute,
  origin,
  travelMode,
  maxMinutes,
  includedTypes,
  k = 20,
  maxCandidateRoutes = 100,
  maxRouteCalls = 100,
  travelThresholds = DEFAULT_TRAVEL_THRESHOLDS,
  ratingFilter = null,
  priceLevels = null,
  operatingStatus = ['OPERATING_STATUS_OPERATIONAL'],
}) {
  if (!envelopeProvider || typeof envelopeProvider.getEnvelope !== 'function') throw new Error('envelope_provider_required');
  if (typeof aggregateSearch !== 'function') throw new Error('aggregate_search_required');
  if (typeof routeMatrixCompute !== 'function') throw new Error('route_matrix_compute_required');
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw new Error('included_types_required');
  validateTopK(k);
  validateCandidateCap(maxCandidateRoutes, k, 'invalid_max_candidate_routes');
  if (!Number.isInteger(maxRouteCalls) || maxRouteCalls < k) throw new Error('invalid_max_route_calls');

  const thresholds = buildTravelThresholds(maxMinutes, travelThresholds);
  const routeCache = new Map();
  const diagnostics = [];
  let envelopeCalls = 0;
  let aggregateCalls = 0;
  let routeCalls = 0;

  for (const thresholdMinutes of thresholds) {
    const envelope = await envelopeProvider.getEnvelope({ origin, travelMode, maxMinutes: thresholdMinutes });
    envelopeCalls += 1;
    if (Number(envelope?.discardedHoleCount || 0) > 0 || Number(envelope?.polygonCount) !== 1 || !Array.isArray(envelope?.polygons?.[0])) {
      return {
        status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'travel_time_envelope_not_simple_exact', topK: [],
        thresholdMinutes, envelopeCalls, aggregateCalls, routeCalls, diagnostics,
      };
    }
    const polygon = toLonLatRing(envelope.polygons[0]);
    const counted = await aggregateSearch({
      polygon, includedTypes, includePlaceIds: false, ratingFilter, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    const count = Number(counted?.count);
    if (!Number.isInteger(count) || count < 0) {
      return { status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'invalid_aggregate_count', topK: [], envelopeCalls, aggregateCalls, routeCalls, diagnostics };
    }
    diagnostics.push({ thresholdMinutes, count });

    const atMax = thresholdMinutes === Number(maxMinutes);
    if (count < k && !atMax) continue;
    if (count > maxCandidateRoutes) {
      return {
        status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'travel_time_candidate_cap_exceeded', topK: [],
        thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, routeCalls, diagnostics,
      };
    }

    const materialized = await materializeAggregateSet({
      aggregateSearch, polygon, includedTypes, expectedCount: count,
      ratingFilter, priceLevels, operatingStatus,
    });
    aggregateCalls += 1;
    if (!materialized.valid) {
      return {
        status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'travel_time_candidate_materialization_incomplete', topK: [],
        thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, routeCalls, diagnostics,
      };
    }

    const routed = [];
    for (const placeId of materialized.placeIds) {
      let seconds = routeCache.get(placeId);
      if (seconds == null) {
        if (routeCalls >= maxRouteCalls) {
          return {
            status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'travel_time_route_call_budget_exhausted', topK: [],
            thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, routeCalls, diagnostics,
          };
        }
        try {
          const route = await routeMatrixCompute({ placeId });
          seconds = durationSecondsFromRouteResult(route);
        } catch (error) {
          return {
            status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: error?.message || 'travel_time_route_failed', topK: [],
            thresholdMinutes, candidateCount: count, envelopeCalls, aggregateCalls, routeCalls, diagnostics,
          };
        }
        routeCalls += 1;
        routeCache.set(placeId, seconds);
      }
      if (seconds <= thresholdMinutes * 60) routed.push({ placeId, travelTimeSeconds: seconds });
    }

    routed.sort((a, b) => a.travelTimeSeconds - b.travelTimeSeconds || a.placeId.localeCompare(b.placeId));
    if (routed.length >= k || atMax) {
      return {
        status: COMPLETE_TOP_K,
        rankingMode: RANKING_MODE.TRAVEL_TIME,
        reason: null,
        topK: routed.slice(0, k),
        candidateCount: count,
        exactQualifiedCount: routed.length,
        selectedThresholdMinutes: thresholdMinutes,
        envelopeCalls,
        aggregateCalls,
        routeCalls,
        diagnostics,
        proof: {
          ranking: 'TRAVEL_TIME_ASC',
          tieBreak: ['PLACE_ID_ASC'],
          k,
          complete: true,
          fewerThanKAvailable: routed.length < k,
          maxMinutes: Number(maxMinutes),
        },
      };
    }
  }

  return {
    status: DEGRADED, rankingMode: RANKING_MODE.TRAVEL_TIME, reason: 'travel_time_proof_incomplete', topK: [],
    envelopeCalls, aggregateCalls, routeCalls, diagnostics,
  };
}

function estimateTopKWorstCase({
  rankingMode,
  k = 20,
  ratingThresholds = DEFAULT_RATING_THRESHOLDS,
  priceLevels = PRICE_LEVELS_ASC,
  travelThresholds = DEFAULT_TRAVEL_THRESHOLDS,
  maxMinutes = 20,
  maxCandidateDetails = 100,
  maxRouteCalls = 100,
  includeFinalistDetails = true,
}) {
  validateTopK(k);
  const finalistDetails = includeFinalistDetails ? k : 0;
  if (rankingMode === RANKING_MODE.RATING) {
    return {
      rankingMode,
      maxEnvelopeCalls: 1,
      maxAggregateCalls: validateThresholds(ratingThresholds).length + 1,
      maxProofDetailCalls: maxCandidateDetails,
      maxRouteElements: 0,
      maxFinalistDetailCalls: finalistDetails,
    };
  }
  if (rankingMode === RANKING_MODE.PRICE) {
    return {
      rankingMode,
      maxEnvelopeCalls: 1,
      maxAggregateCalls: priceLevels.length * 2,
      maxProofDetailCalls: 0,
      maxRouteElements: 0,
      maxFinalistDetailCalls: finalistDetails,
    };
  }
  if (rankingMode === RANKING_MODE.TRAVEL_TIME) {
    const thresholds = buildTravelThresholds(maxMinutes, travelThresholds);
    return {
      rankingMode,
      maxEnvelopeCalls: thresholds.length,
      maxAggregateCalls: thresholds.length * 2,
      maxProofDetailCalls: 0,
      maxRouteElements: maxRouteCalls,
      maxFinalistDetailCalls: finalistDetails,
    };
  }
  throw new Error('unsupported_ranking_mode');
}

async function proveTopK({ rankingMode, ...options }) {
  if (rankingMode === RANKING_MODE.RATING) return proveTopKByRating(options);
  if (rankingMode === RANKING_MODE.PRICE) return proveTopKByPrice(options);
  if (rankingMode === RANKING_MODE.TRAVEL_TIME) return proveTopKByTravelTime(options);
  throw new Error('unsupported_ranking_mode');
}

module.exports = {
  COMPLETE_TOP_K,
  DEGRADED,
  RANKING_MODE,
  DEFAULT_RATING_THRESHOLDS,
  PRICE_LEVELS_ASC,
  DEFAULT_TRAVEL_THRESHOLDS,
  buildTravelThresholds,
  candidateComparator,
  durationSecondsFromRouteResult,
  estimateTopKWorstCase,
  exactFiveStarTopK,
  proveTopK,
  proveTopKByPrice,
  proveTopKByRating,
  proveTopKByTravelTime,
  uniquePlaceIds,
  validateThresholds,
};
