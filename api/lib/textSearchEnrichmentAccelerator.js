'use strict';

const TEXT_SEARCH_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const MAX_TEXT_SEARCH_PAGES = 3;
const PAGE_SIZE = 20;

const SKU = Object.freeze({
  TEXT_SEARCH_ENTERPRISE: 'E967-44BC-B44D',
  TEXT_SEARCH_ENTERPRISE_ATMOSPHERE: '120C-BEC3-B48F',
  PLACE_DETAILS_ENTERPRISE: '2D9A-3DE0-3766',
});

// Global PAYG first paid tier, USD micro-units per successful request/event.
// Source of truth remains Google Maps Platform pricing; these values must be
// re-verified before any production wallet migration.
const LIST_PRICE_MICROUSD = Object.freeze({
  textSearchEnterprise: 35000,
  textSearchEnterpriseAtmosphere: 40000,
  placeDetailsEnterprise: 20000,
});

const ENTERPRISE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours',
  'nextPageToken',
].join(',');

const ATMOSPHERE_FIELD_MASK = `${ENTERPRISE_FIELD_MASK},routingSummaries`;

function normalizePlaceId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('places/') ? trimmed.slice('places/'.length) : trimmed;
}

function normalizeTravelMode(value) {
  const map = {
    Walk: 'WALK',
    Drive: 'DRIVE',
    Bike: 'BICYCLE',
    WALK: 'WALK',
    DRIVE: 'DRIVE',
    BICYCLE: 'BICYCLE',
    TWO_WHEELER: 'TWO_WHEELER',
  };
  const mode = map[value];
  if (!mode) throw new Error('invalid_travel_mode');
  return mode;
}

function validateCircle(circle) {
  const latitude = Number(circle?.center?.latitude);
  const longitude = Number(circle?.center?.longitude);
  const radius = Number(circle?.radius);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('invalid_circle_latitude');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('invalid_circle_longitude');
  if (!Number.isFinite(radius) || radius <= 0 || radius > 50000) throw new Error('invalid_circle_radius');
  return { center: { latitude, longitude }, radius };
}

function normalizePriceLevels(priceLevels) {
  if (priceLevels == null) return null;
  if (!Array.isArray(priceLevels) || priceLevels.length === 0) throw new Error('invalid_price_levels');
  return [...new Set(priceLevels.map((value) => String(value || '').trim()).filter(Boolean))];
}

function attachRoutingSummaries(payload) {
  const places = Array.isArray(payload?.places) ? payload.places : [];
  const summaries = Array.isArray(payload?.routingSummaries) ? payload.routingSummaries : [];
  return places.map((place, index) => ({
    ...place,
    ...(summaries[index] ? { routingSummary: summaries[index] } : {}),
  }));
}

function reconcileAggregateCandidates({ aggregatePlaceIds, textSearchPlaces }) {
  const aggregateIds = [...new Set((aggregatePlaceIds || []).map(normalizePlaceId).filter(Boolean))];
  const aggregateSet = new Set(aggregateIds);
  const matchedById = new Map();

  for (const place of textSearchPlaces || []) {
    const id = normalizePlaceId(place?.id || place?.name);
    if (!id || !aggregateSet.has(id) || matchedById.has(id)) continue;
    matchedById.set(id, { ...place, id });
  }

  const matchedIds = aggregateIds.filter((id) => matchedById.has(id));
  const missingIds = aggregateIds.filter((id) => !matchedById.has(id));
  const overlapRate = aggregateIds.length === 0 ? 1 : matchedIds.length / aggregateIds.length;

  return Object.freeze({
    aggregateCount: aggregateIds.length,
    matchedCount: matchedIds.length,
    missingCount: missingIds.length,
    overlapRate,
    matchedIds: Object.freeze(matchedIds),
    missingIds: Object.freeze(missingIds),
    matchedPlaces: Object.freeze(matchedIds.map((id) => matchedById.get(id))),
  });
}

function estimateObservedEnrichmentCost({
  textSearchCalls,
  missingCount,
  includeRouting = false,
  prices = LIST_PRICE_MICROUSD,
}) {
  const calls = Number(textSearchCalls);
  const missing = Number(missingCount);
  if (!Number.isInteger(calls) || calls < 0) throw new Error('invalid_text_search_calls');
  if (!Number.isInteger(missing) || missing < 0) throw new Error('invalid_missing_count');

  const textSearchUnit = includeRouting
    ? Number(prices.textSearchEnterpriseAtmosphere)
    : Number(prices.textSearchEnterprise);
  const detailsUnit = Number(prices.placeDetailsEnterprise);
  if (!Number.isInteger(textSearchUnit) || textSearchUnit <= 0) throw new Error('invalid_text_search_price');
  if (!Number.isInteger(detailsUnit) || detailsUnit <= 0) throw new Error('invalid_details_price');

  const textSearchMicroUsd = calls * textSearchUnit;
  const reconciliationMicroUsd = missing * detailsUnit;
  return Object.freeze({
    textSearchMicroUsd,
    reconciliationMicroUsd,
    totalMicroUsd: textSearchMicroUsd + reconciliationMicroUsd,
  });
}

function createTextSearchEnrichmentAccelerator({ apiKey, fetchImpl = global.fetch }) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('google_api_key_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_required');

  async function searchPages({
    textQuery,
    includedType,
    locationBiasCircle,
    pageLimit = MAX_TEXT_SEARCH_PAGES,
    minRating = null,
    openNow = null,
    priceLevels = null,
    includeRouting = false,
    routingOrigin = null,
    travelMode = null,
  }) {
    const query = String(textQuery || '').trim();
    if (!query) throw new Error('text_query_required');
    const type = String(includedType || '').trim();
    if (!type) throw new Error('included_type_required');
    const limit = Number(pageLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TEXT_SEARCH_PAGES) throw new Error('invalid_page_limit');
    const circle = validateCircle(locationBiasCircle);
    const safePriceLevels = normalizePriceLevels(priceLevels);

    if (minRating != null) {
      const rating = Number(minRating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) throw new Error('invalid_min_rating');
    }

    let routingParameters = null;
    if (includeRouting) {
      const latitude = Number(routingOrigin?.latitude);
      const longitude = Number(routingOrigin?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('routing_origin_required');
      routingParameters = {
        origin: { latitude, longitude },
        travelMode: normalizeTravelMode(travelMode),
      };
    }

    const places = [];
    let pageToken = null;
    let calls = 0;

    for (let page = 0; page < limit; page += 1) {
      const body = {
        textQuery: query,
        includedType: type,
        strictTypeFiltering: true,
        pageSize: PAGE_SIZE,
        locationBias: { circle },
        ...(minRating == null ? {} : { minRating: Number(minRating) }),
        ...(openNow == null ? {} : { openNow: Boolean(openNow) }),
        ...(safePriceLevels ? { priceLevels: safePriceLevels } : {}),
        ...(routingParameters ? { routingParameters } : {}),
        ...(pageToken ? { pageToken } : {}),
      };

      const response = await fetchImpl(TEXT_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': includeRouting ? ATMOSPHERE_FIELD_MASK : ENTERPRISE_FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
      calls += 1;

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`google_text_search_failed_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`);
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      places.push(...attachRoutingSummaries(payload));
      pageToken = typeof payload?.nextPageToken === 'string' && payload.nextPageToken.trim()
        ? payload.nextPageToken.trim()
        : null;
      if (!pageToken) break;
    }

    return Object.freeze({
      places: Object.freeze(places),
      calls,
      exhausted: !pageToken,
      nextPageToken: pageToken,
      skuId: includeRouting ? SKU.TEXT_SEARCH_ENTERPRISE_ATMOSPHERE : SKU.TEXT_SEARCH_ENTERPRISE,
    });
  }

  return Object.freeze({ searchPages });
}

module.exports = {
  ATMOSPHERE_FIELD_MASK,
  ENTERPRISE_FIELD_MASK,
  LIST_PRICE_MICROUSD,
  MAX_TEXT_SEARCH_PAGES,
  PAGE_SIZE,
  SKU,
  TEXT_SEARCH_ENDPOINT,
  attachRoutingSummaries,
  createTextSearchEnrichmentAccelerator,
  estimateObservedEnrichmentCost,
  normalizePlaceId,
  reconcileAggregateCandidates,
};
