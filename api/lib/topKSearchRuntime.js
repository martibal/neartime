'use strict';

const crypto = require('crypto');
const { createGoogleCoverageProvider, SKU } = require('./googleCoverageProvider');
const { createGoogleIsochroneEnvelopeProvider } = require('./googleIsochroneEnvelopeProvider');
const { createRouteMatrixFallback, routeMatrixSkuForTravelMode } = require('./routeMatrixFallback');
const {
  COMPLETE_TOP_K,
  DEGRADED,
  RANKING_MODE,
  durationSecondsFromRouteResult,
  estimateTopKWorstCase,
  proveTopK,
} = require('./topKProofPlanner');

const CATEGORY_TYPES = Object.freeze({
  Restaurant: ['restaurant'],
  Cafe: ['cafe'],
  Grocery: ['grocery_store'],
  Pharmacy: ['pharmacy'],
  Parking: ['parking'],
});

const PRICE_LEVELS = Object.freeze({
  PRICE_LEVEL_FREE: { level: 0, label: 'Free' },
  PRICE_LEVEL_INEXPENSIVE: { level: 1, label: '$' },
  PRICE_LEVEL_MODERATE: { level: 2, label: '$$' },
  PRICE_LEVEL_EXPENSIVE: { level: 3, label: '$$$' },
  PRICE_LEVEL_VERY_EXPENSIVE: { level: 4, label: '$$$$' },
});

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeRankingMode(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!Object.values(RANKING_MODE).includes(normalized)) throw new Error('invalid_ranking_mode');
  return normalized;
}

function unsupportedHardFilterReason(query) {
  if (Number(query?.minimumReviews || 0) > 0) return 'top_k_minimum_reviews_proof_not_ready';
  if (query?.openNow === true) return 'top_k_open_now_proof_not_ready';
  if (Number(query?.openForMinutes || 0) > 0) return 'top_k_open_for_minutes_proof_not_ready';
  return null;
}

function toLonLatRing(points) {
  if (!Array.isArray(points) || points.length < 4) throw new Error('top_k_polygon_required');
  return points.map((point) => [Number(point?.longitude), Number(point?.latitude)]);
}

function hardRatingFilter(query) {
  const minimumRating = Number(query?.minimumRating || 0);
  return minimumRating >= 1 ? { minRating: minimumRating, maxRating: 5 } : null;
}

function mergeRatingFilter(requested, hardMinimum) {
  if (!requested && !hardMinimum) return null;
  const requestedMin = requested?.minRating == null ? 1 : Number(requested.minRating);
  const requestedMax = requested?.maxRating == null ? 5 : Number(requested.maxRating);
  const hardMin = hardMinimum?.minRating == null ? 1 : Number(hardMinimum.minRating);
  const hardMax = hardMinimum?.maxRating == null ? 5 : Number(hardMinimum.maxRating);
  const minRating = Math.max(requestedMin, hardMin);
  const maxRating = Math.min(requestedMax, hardMax);
  if (minRating > maxRating) return { minRating: maxRating, maxRating };
  return { minRating, maxRating };
}

function budgetQuantities({ rankingMode, travelMode, maxMinutes, k = 20 }) {
  const mode = normalizeRankingMode(rankingMode);
  const plan = estimateTopKWorstCase({ rankingMode: mode, maxMinutes, k });
  return Object.freeze({
    aggregate: plan.maxAggregateCalls,
    details: plan.maxProofDetailCalls + plan.maxFinalistDetailCalls,
    route: plan.maxRouteElements + k,
    routeSkuId: routeMatrixSkuForTravelMode(travelMode),
  });
}

function reservationKey(searchKey, skuId) {
  return crypto.createHash('sha256').update(`topk:${searchKey}:${skuId}`).digest('hex');
}

async function releaseReservations(reservations, supabaseRpc) {
  for (const reservation of reservations) {
    try {
      await supabaseRpc('finish_provider_cogs_reservation', {
        p_reservation_id: reservation.reservationId,
        p_outcome: 'released',
        p_actual_quantity: 0,
      });
    } catch {
      // Conservative hold expires if explicit release cannot be recorded.
    }
  }
}

async function reserveWorstCaseBudget({ entitlementHash, deviceId, searchKey, quantities, supabaseRpc }) {
  const specs = [
    { name: 'aggregate', skuId: SKU.AGGREGATE, quantity: quantities.aggregate },
    { name: 'details', skuId: SKU.PLACE_DETAILS_ENTERPRISE, quantity: quantities.details },
    { name: 'route', skuId: quantities.routeSkuId, quantity: quantities.route },
  ].filter((spec) => Number(spec.quantity) > 0);

  const reservations = [];
  for (const spec of specs) {
    const decision = firstRow(await supabaseRpc('reserve_provider_cogs', {
      p_entitlement_hash: entitlementHash,
      p_device_id: deviceId,
      p_sku_id: spec.skuId,
      p_quantity: spec.quantity,
      p_idempotency_key: reservationKey(searchKey, spec.skuId),
      p_ttl_seconds: 600,
    }));
    if (!decision?.allowed || !decision?.reservation_id) {
      await releaseReservations(reservations, supabaseRpc);
      const error = new Error(decision?.reason || 'provider_budget_reservation_denied');
      error.code = decision?.reason || 'provider_budget_reservation_denied';
      throw error;
    }
    reservations.push({
      ...spec,
      reservationId: decision.reservation_id,
      reservedMicroUsd: decision.reserved_micro_usd ?? null,
    });
  }
  return reservations;
}

async function settleWorstCaseBudget({ reservations, actual, outcome, supabaseRpc }) {
  for (const reservation of reservations) {
    const quantity = Number(actual[reservation.name] || 0);
    const settlement = firstRow(await supabaseRpc('finish_provider_cogs_reservation', {
      p_reservation_id: reservation.reservationId,
      p_outcome: quantity === 0 ? 'released' : outcome,
      p_actual_quantity: quantity,
    }));
    if (!settlement?.ok) {
      const error = new Error(settlement?.reason || 'provider_budget_settlement_failed');
      error.code = settlement?.reason || 'provider_budget_settlement_failed';
      throw error;
    }
  }
}

function closingMinutes(openingHours) {
  if (!openingHours?.openNow) return 0;
  if (!openingHours.nextCloseTime) return 7 * 24 * 60;
  const closeMs = Date.parse(openingHours.nextCloseTime);
  if (!Number.isFinite(closeMs)) return 0;
  return Math.max(0, Math.floor((closeMs - Date.now()) / 60000));
}

function mapPlace({ details, route, candidate, origin, query }) {
  const seconds = durationSecondsFromRouteResult(route);
  const distanceMeters = Number(route?.routingSummary?.legs?.[0]?.distanceMeters ?? 0);
  const latitude = Number(details?.location?.latitude);
  const longitude = Number(details?.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('top_k_place_location_missing');
  const travelMinutes = Math.ceil(seconds / 60);
  const unknown = 9999;
  const price = PRICE_LEVELS[details?.priceLevel] ?? { level: 0, label: '—' };
  return {
    id: String(details?.id || candidate?.placeId || ''),
    name: String(details?.displayName?.text || ''),
    category: query.category,
    walkMinutes: query.travelMode === 'Walk' ? travelMinutes : unknown,
    driveMinutes: query.travelMode === 'Drive' ? travelMinutes : unknown,
    bikeMinutes: query.travelMode === 'Bike' ? travelMinutes : unknown,
    distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
    rating: Number(details?.rating ?? candidate?.rating ?? 0),
    reviewCount: Number(details?.userRatingCount ?? candidate?.userRatingCount ?? 0),
    priceLevel: price.level,
    price: price.label,
    open: details?.currentOpeningHours?.openNow === true,
    closesInMinutes: closingMinutes(details?.currentOpeningHours),
    address: String(details?.formattedAddress || ''),
    phone: '',
    website: '',
    highlights: [],
    latitudeOffset: latitude - Number(origin.latitude),
    longitudeOffset: longitude - Number(origin.longitude),
  };
}

async function runTopKSearchRuntime({
  apiKey,
  entitlementHash,
  deviceId,
  searchKey,
  origin,
  query,
  supabaseRpc,
  fetchImpl = global.fetch,
  k = 20,
}) {
  if (!apiKey || !entitlementHash || !deviceId || !searchKey) throw new Error('top_k_runtime_identity_required');
  if (typeof supabaseRpc !== 'function') throw new Error('supabase_rpc_required');
  const rankingMode = normalizeRankingMode(query?.rankingMode);
  const includedTypes = CATEGORY_TYPES[query?.category];
  if (!includedTypes) throw new Error('invalid_category');
  const unsupportedReason = unsupportedHardFilterReason(query);
  if (unsupportedReason) {
    return { status: DEGRADED, rankingMode, reason: unsupportedReason, places: [], providerCalls: { aggregate: 0, details: 0, route: 0, envelope: 0 } };
  }

  const quantities = budgetQuantities({ rankingMode, travelMode: query.travelMode, maxMinutes: Number(query.maxMinutes), k });
  const reservations = await reserveWorstCaseBudget({ entitlementHash, deviceId, searchKey, quantities, supabaseRpc });
  const actual = { aggregate: 0, details: 0, route: 0, envelope: 0 };
  let settled = false;

  try {
    const provider = createGoogleCoverageProvider({ apiKey, origin, travelMode: query.travelMode, fetchImpl });
    const envelopeProvider = createGoogleIsochroneEnvelopeProvider({ apiKey, fetchImpl });
    const routeMatrix = createRouteMatrixFallback({ apiKey, origin, travelMode: query.travelMode, fetchImpl });
    const hardRating = hardRatingFilter(query);

    const aggregateSearch = async (args) => {
      actual.aggregate += 1;
      return provider.aggregateSearch({ ...args, ratingFilter: mergeRatingFilter(args.ratingFilter, hardRating) });
    };
    const placeDetails = async (args) => {
      actual.details += 1;
      return provider.placeDetails(args);
    };
    const routeMatrixCompute = async (args) => {
      actual.route += 1;
      return routeMatrix.compute(args);
    };
    const trackedEnvelopeProvider = {
      async getEnvelope(args) {
        actual.envelope += 1;
        return envelopeProvider.getEnvelope(args);
      },
    };

    let proof;
    if (rankingMode === RANKING_MODE.TRAVEL_TIME) {
      proof = await proveTopK({
        rankingMode,
        envelopeProvider: trackedEnvelopeProvider,
        aggregateSearch,
        routeMatrixCompute,
        origin,
        travelMode: query.travelMode,
        maxMinutes: Number(query.maxMinutes),
        includedTypes,
        k,
        ratingFilter: hardRating,
      });
    } else {
      const envelope = await trackedEnvelopeProvider.getEnvelope({
        origin,
        travelMode: query.travelMode,
        maxMinutes: Number(query.maxMinutes),
      });
      if (Number(envelope?.discardedHoleCount || 0) > 0 || Number(envelope?.polygonCount) !== 1 || !Array.isArray(envelope?.polygons?.[0])) {
        proof = { status: DEGRADED, rankingMode, reason: 'top_k_envelope_not_simple_exact', topK: [] };
      } else {
        const polygon = toLonLatRing(envelope.polygons[0]);
        proof = rankingMode === RANKING_MODE.RATING
          ? await proveTopK({ rankingMode, polygon, includedTypes, aggregateSearch, placeDetails, k })
          : await proveTopK({ rankingMode, polygon, includedTypes, aggregateSearch, k, ratingFilter: hardRating });
      }
    }

    if (proof.status !== COMPLETE_TOP_K) {
      await settleWorstCaseBudget({ reservations, actual, outcome: 'succeeded', supabaseRpc });
      settled = true;
      return { ...proof, places: [], providerCalls: actual, budgetPlan: quantities };
    }

    const places = [];
    for (const candidate of proof.topK) {
      const details = candidate.details || await placeDetails({ placeId: candidate.placeId });
      const route = await routeMatrixCompute({ placeId: candidate.placeId });
      const seconds = durationSecondsFromRouteResult(route);
      if (seconds > Number(query.maxMinutes) * 60) {
        await settleWorstCaseBudget({ reservations, actual, outcome: 'succeeded', supabaseRpc });
        settled = true;
        return {
          status: DEGRADED,
          rankingMode,
          reason: 'top_k_finalist_route_outside_max_time',
          places: [],
          proof,
          providerCalls: actual,
          budgetPlan: quantities,
        };
      }
      const place = mapPlace({ details, route, candidate, origin, query });
      if (Number(query.minimumRating || 0) > 0 && place.rating < Number(query.minimumRating)) {
        await settleWorstCaseBudget({ reservations, actual, outcome: 'succeeded', supabaseRpc });
        settled = true;
        return {
          status: DEGRADED,
          rankingMode,
          reason: 'top_k_finalist_rating_contract_mismatch',
          places: [],
          proof,
          providerCalls: actual,
          budgetPlan: quantities,
        };
      }
      places.push(place);
    }

    await settleWorstCaseBudget({ reservations, actual, outcome: 'succeeded', supabaseRpc });
    settled = true;
    return {
      status: COMPLETE_TOP_K,
      rankingMode,
      reason: null,
      places,
      proof,
      providerCalls: actual,
      budgetPlan: quantities,
    };
  } catch (error) {
    if (!settled) {
      try {
        await settleWorstCaseBudget({ reservations, actual, outcome: 'failed', supabaseRpc });
        settled = true;
      } catch {
        // Reservations remain conservative until expiry if settlement fails.
      }
    }
    throw error;
  }
}

module.exports = {
  CATEGORY_TYPES,
  budgetQuantities,
  hardRatingFilter,
  mergeRatingFilter,
  normalizeRankingMode,
  reservationKey,
  runTopKSearchRuntime,
  unsupportedHardFilterReason,
};
