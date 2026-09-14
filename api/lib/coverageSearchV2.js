'use strict';

const { runCoverageSearch, RESULT_STATUS, COVERAGE_STATE } = require('./coverageOrchestrator');
const { createGoogleCoverageProvider } = require('./googleCoverageProvider');
const { createProviderCogsHooks } = require('./providerCogsHooks');
const { createRouteMatrixFallback, enrichFallbackPlaceWithRoute } = require('./routeMatrixFallback');

const CATEGORY_TYPES_V1 = Object.freeze({
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

function parseDurationSeconds(duration) {
  if (typeof duration !== 'string' || !duration.endsWith('s')) return null;
  const seconds = Number(duration.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function closingMinutes(openingHours) {
  if (!openingHours?.openNow) return 0;
  if (!openingHours.nextCloseTime) return 7 * 24 * 60;
  const closeMs = Date.parse(openingHours.nextCloseTime);
  if (!Number.isFinite(closeMs)) return 0;
  return Math.max(0, Math.floor((closeMs - Date.now()) / 60000));
}

function priceInfo(priceLevel) {
  return PRICE_LEVELS[priceLevel] ?? { level: 0, label: '—' };
}

function attachRoutingSummaries(payload) {
  const places = Array.isArray(payload?.places) ? payload.places : [];
  const routing = Array.isArray(payload?.routingSummaries) ? payload.routingSummaries : [];
  return {
    ...payload,
    places: places.map((place, index) => ({ ...place, __routingSummary: routing[index] ?? null })),
  };
}

function mapCandidate(place, origin, query) {
  const seconds = parseDurationSeconds(place?.__routingSummary?.legs?.[0]?.duration);
  if (seconds === null) return { unresolved: true, id: String(place?.id ?? '') };
  const latitude = Number(place?.location?.latitude);
  const longitude = Number(place?.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { unresolved: true, id: String(place?.id ?? '') };
  }

  const minutes = Math.ceil(seconds / 60);
  const distanceMeters = Number(place?.__routingSummary?.legs?.[0]?.distanceMeters ?? 0);
  const price = priceInfo(place?.priceLevel);
  const unknown = 9999;

  return {
    unresolved: false,
    value: {
      id: String(place?.id ?? ''),
      name: String(place?.displayName?.text ?? ''),
      category: query.category,
      walkMinutes: query.travelMode === 'Walk' ? minutes : unknown,
      driveMinutes: query.travelMode === 'Drive' ? minutes : unknown,
      bikeMinutes: query.travelMode === 'Bike' ? minutes : unknown,
      distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
      rating: Number(place?.rating ?? 0),
      reviewCount: Number(place?.userRatingCount ?? 0),
      priceLevel: price.level,
      price: price.label,
      open: place?.currentOpeningHours?.openNow === true,
      closesInMinutes: closingMinutes(place?.currentOpeningHours),
      address: String(place?.formattedAddress ?? ''),
      phone: '',
      website: '',
      highlights: [],
      latitudeOffset: latitude - Number(origin.latitude),
      longitudeOffset: longitude - Number(origin.longitude),
    },
  };
}

function filterCandidates(candidates, origin, query) {
  const unresolvedIds = [];
  const mapped = [];
  for (const candidate of candidates) {
    const result = mapCandidate(candidate, origin, query);
    if (result.unresolved) {
      if (result.id) unresolvedIds.push(result.id);
      continue;
    }
    mapped.push(result.value);
  }

  const timeKey = query.travelMode === 'Walk' ? 'walkMinutes' : query.travelMode === 'Drive' ? 'driveMinutes' : 'bikeMinutes';
  const places = mapped.filter((place) => {
    if (place[timeKey] > Number(query.maxMinutes)) return false;
    if (place.rating < Number(query.minimumRating)) return false;
    if (place.reviewCount < Number(query.minimumReviews)) return false;
    if (query.openNow && !place.open) return false;
    if (Number(query.openForMinutes) > 0 && place.closesInMinutes < Number(query.openForMinutes)) return false;
    return true;
  });

  return { places, unresolvedIds };
}

function economicGateReason(reason) {
  return [
    'provider_budget_exhausted',
    'external_calls_disabled',
    'kill_switch_active',
    'wallet_not_found',
    'entitlement_inactive',
    'sku_price_not_found',
  ].find((code) => String(reason || '').includes(code)) || null;
}

async function runCoverageSearchV2({
  activation,
  apiKey,
  entitlementHash,
  deviceId,
  supabaseRpc,
  origin,
  query,
  radiusMeters,
  searchKey,
  options,
  fetchImpl,
}) {
  if (activation?.enabled !== true) {
    const error = new Error('coverage_v2_disabled');
    error.code = 'coverage_v2_disabled';
    throw error;
  }
  if (activation?.geometryVerified !== true) {
    const error = new Error('coverage_geometry_not_verified');
    error.code = 'coverage_geometry_not_verified';
    throw error;
  }
  const categoryTypes = CATEGORY_TYPES_V1[query?.category];
  if (!categoryTypes) throw new Error('invalid_category');
  if (!Number.isFinite(Number(radiusMeters)) || Number(radiusMeters) <= 0) throw new Error('invalid_radius');

  const provider = createGoogleCoverageProvider({ apiKey, origin, travelMode: query.travelMode, fetchImpl });
  const hooks = createProviderCogsHooks({ entitlementHash, deviceId, supabaseRpc });
  const routeMatrix = createRouteMatrixFallback({ apiKey, origin, travelMode: query.travelMode, fetchImpl });
  let unresolvedRouteIds = [];

  const result = await runCoverageSearch({
    origin,
    radiusMeters: Number(radiusMeters),
    categoryTypes,
    searchKey,
    aggregateSearch: provider.aggregateSearch,
    nearbySearch: async (args) => attachRoutingSummaries(await provider.nearbySearch(args)),
    placeDetails: async (args) => {
      const place = await provider.placeDetails(args);
      return enrichFallbackPlaceWithRoute({
        place,
        placeId: args.placeId,
        searchKey,
        hooks,
        routeMatrix,
      });
    },
    applyHardFilters: (candidates) => {
      const filtered = filterCandidates(candidates, origin, query);
      unresolvedRouteIds = filtered.unresolvedIds;
      return filtered.places;
    },
    hooks,
    options,
  });

  const gate = economicGateReason(result.coverageReason);
  if (gate) {
    const error = new Error(gate);
    error.code = gate;
    throw error;
  }

  if (unresolvedRouteIds.length > 0 && result.coverageState === COVERAGE_STATE.VERIFIED_CURRENT) {
    return {
      ...result,
      resultStatus: RESULT_STATUS.DEGRADED,
      coverageState: COVERAGE_STATE.UNVERIFIED,
      coverageReason: `route_time_unresolved:${unresolvedRouteIds.join(',')}`,
    };
  }

  return result;
}

module.exports = {
  CATEGORY_TYPES_V1,
  attachRoutingSummaries,
  filterCandidates,
  runCoverageSearchV2,
};
