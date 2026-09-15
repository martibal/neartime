'use strict';

const COMPLETE_TOP_K = 'COMPLETE_TOP_K';
const DEGRADED = 'DEGRADED';

const DEFAULT_RATING_THRESHOLDS = Object.freeze([
  5.0,
  4.9,
  4.8,
  4.7,
  4.6,
  4.5,
  4.4,
  4.3,
  4.2,
  4.1,
  4.0,
  3.5,
  3.0,
  2.5,
  2.0,
  1.5,
  1.0,
]);

function normalizePlaceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('places/') ? trimmed.slice('places/'.length) : trimmed;
}

function uniquePlaceIds(values) {
  return [...new Set((values || []).map(normalizePlaceId).filter(Boolean))];
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
  const orderedIds = [...placeIds].sort((a, b) => a.localeCompare(b));
  return orderedIds.slice(0, k).map((placeId) => ({
    placeId,
    rating: 5,
    userRatingCount: null,
    details: null,
  }));
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
  if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('invalid_top_k');
  if (!Number.isInteger(maxCandidateDetails) || maxCandidateDetails < k || maxCandidateDetails > 100) {
    throw new Error('invalid_max_candidate_details');
  }

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
      return {
        status: DEGRADED,
        reason: 'invalid_aggregate_count',
        topK: [],
        aggregateCalls,
        detailCalls,
        diagnostics,
      };
    }
    diagnostics.push({ minRating, count });

    if (count >= k || minRating === 1) {
      selectedThreshold = minRating;
      selectedCount = count;
      break;
    }
  }

  if (selectedThreshold == null || selectedCount == null) {
    return {
      status: DEGRADED,
      reason: 'rating_threshold_proof_incomplete',
      topK: [],
      aggregateCalls,
      detailCalls,
      diagnostics,
    };
  }

  if (selectedCount > maxCandidateDetails) {
    return {
      status: DEGRADED,
      reason: 'top_k_candidate_cap_exceeded',
      topK: [],
      candidateCount: selectedCount,
      selectedThreshold,
      aggregateCalls,
      detailCalls,
      diagnostics,
    };
  }

  if (selectedCount === 0) {
    return {
      status: COMPLETE_TOP_K,
      reason: null,
      topK: [],
      candidateCount: 0,
      selectedThreshold,
      aggregateCalls,
      detailCalls,
      diagnostics,
      proof: {
        ranking: 'RATING_DESC',
        k,
        complete: true,
        fewerThanKAvailable: true,
      },
    };
  }

  const materialized = await aggregateSearch({
    polygon,
    includedTypes,
    includePlaceIds: true,
    ratingFilter: { minRating: selectedThreshold, maxRating: 5 },
    priceLevels,
    operatingStatus,
  });
  aggregateCalls += 1;

  const materializedCount = Number(materialized?.count);
  const placeIds = uniquePlaceIds(materialized?.placeIds ?? materialized?.placeInsights?.map((entry) => entry?.place));
  if (materializedCount !== selectedCount || placeIds.length !== selectedCount) {
    return {
      status: DEGRADED,
      reason: 'top_k_candidate_materialization_incomplete',
      topK: [],
      candidateCount: selectedCount,
      selectedThreshold,
      aggregateCalls,
      detailCalls,
      diagnostics,
    };
  }

  // If the first proven bucket is exactly 5.0, every materialized candidate is tied
  // on the user's chosen ranking criterion. Any deterministic K-subset is therefore
  // a valid complete top-K result. Do not spend on Place Details merely to invent a
  // secondary ranking the user did not request.
  if (selectedThreshold === 5) {
    return {
      status: COMPLETE_TOP_K,
      reason: null,
      topK: exactFiveStarTopK(placeIds, k),
      candidateCount: selectedCount,
      selectedThreshold,
      aggregateCalls,
      detailCalls,
      diagnostics,
      proof: {
        ranking: 'RATING_DESC',
        tiePolicy: 'RATING_TIES_EQUIVALENT',
        deterministicSelection: 'PLACE_ID_ASC',
        k,
        complete: true,
        fewerThanKAvailable: selectedCount < k,
        excludedBelowRating: selectedThreshold,
      },
    };
  }

  const candidates = [];
  for (const placeId of placeIds) {
    const details = await placeDetails({ placeId });
    detailCalls += 1;
    const rating = Number(details?.rating);
    const userRatingCount = Number(details?.userRatingCount ?? 0);
    if (!Number.isFinite(rating) || rating < selectedThreshold || rating > 5) {
      return {
        status: DEGRADED,
        reason: 'top_k_rating_filter_contract_mismatch',
        topK: [],
        candidateCount: selectedCount,
        selectedThreshold,
        aggregateCalls,
        detailCalls,
        diagnostics,
      };
    }
    candidates.push({
      placeId,
      rating,
      userRatingCount: Number.isFinite(userRatingCount) && userRatingCount >= 0 ? userRatingCount : 0,
      details,
    });
  }

  candidates.sort(candidateComparator);
  const topK = candidates.slice(0, k);

  return {
    status: COMPLETE_TOP_K,
    reason: null,
    topK,
    candidateCount: selectedCount,
    selectedThreshold,
    aggregateCalls,
    detailCalls,
    diagnostics,
    proof: {
      ranking: 'RATING_DESC',
      tieBreak: ['USER_RATING_COUNT_DESC', 'PLACE_ID_ASC'],
      k,
      complete: true,
      fewerThanKAvailable: selectedCount < k,
      excludedBelowRating: selectedThreshold,
    },
  };
}

module.exports = {
  COMPLETE_TOP_K,
  DEGRADED,
  DEFAULT_RATING_THRESHOLDS,
  candidateComparator,
  exactFiveStarTopK,
  proveTopKByRating,
  uniquePlaceIds,
  validateThresholds,
};
