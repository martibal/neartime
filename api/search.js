const {
  requiredEnv,
  sha256Hex,
  supabaseRpc,
  resolveEntitlementSession,
} = require('./lib/entitlements');

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const COST_SERVICE = 'places-text-search-enterprise-atmosphere';
const COST_UNITS_PER_PROVIDER_CALL = 1;
const MAX_PROVIDER_CALLS_PER_SEARCH = 3;
const RESERVED_COST_UNITS = COST_UNITS_PER_PROVIDER_CALL * MAX_PROVIDER_CALLS_PER_SEARCH;
const RESULT_LIMIT = 20;

const CATEGORY_TO_GOOGLE_TYPE = {
  Restaurant: 'restaurant',
  Cafe: 'cafe',
  Grocery: 'grocery_store',
  Pharmacy: 'pharmacy',
  Parking: 'parking',
};

const CATEGORY_TO_TEXT_QUERY = {
  Restaurant: 'restaurants',
  Cafe: 'cafes',
  Grocery: 'grocery stores',
  Pharmacy: 'pharmacies',
  Parking: 'parking',
};

const TRAVEL_MODE_TO_GOOGLE = {
  Walk: 'WALK',
  Drive: 'DRIVE',
  Bike: 'BICYCLE',
};

const RADIUS_METERS_PER_MINUTE = {
  Walk: 150,
  Bike: 600,
  Drive: 2500,
};

const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: { level: 0, label: 'Free' },
  PRICE_LEVEL_INEXPENSIVE: { level: 1, label: '$' },
  PRICE_LEVEL_MODERATE: { level: 2, label: '$$' },
  PRICE_LEVEL_EXPENSIVE: { level: 3, label: '$$$' },
  PRICE_LEVEL_VERY_EXPENSIVE: { level: 4, label: '$$$$' },
};

function send(res, status, payload) {
  res.status(status).json(payload);
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateRequest(body) {
  if (!body || typeof body !== 'object') return 'invalid_body';
  const { query, origin } = body;
  if (!query || typeof query !== 'object') return 'invalid_query';
  if (!origin || typeof origin !== 'object') return 'invalid_origin';
  if (!CATEGORY_TO_GOOGLE_TYPE[query.category]) return 'invalid_category';
  if (!TRAVEL_MODE_TO_GOOGLE[query.travelMode]) return 'invalid_travel_mode';
  if (![5, 10, 15, 20].includes(Number(query.maxMinutes))) return 'invalid_max_minutes';
  if (![0, 100, 300, 1000].includes(Number(query.minimumReviews))) return 'invalid_minimum_reviews';
  if (![0, 60, 120, 180].includes(Number(query.openForMinutes))) return 'invalid_open_for_minutes';

  const rating = asFiniteNumber(query.minimumRating);
  if (rating === null || rating < 0 || rating > 5) return 'invalid_minimum_rating';
  const latitude = asFiniteNumber(origin.latitude);
  const longitude = asFiniteNumber(origin.longitude);
  if (latitude === null || latitude < -90 || latitude > 90) return 'invalid_latitude';
  if (longitude === null || longitude < -180 || longitude > 180) return 'invalid_longitude';
  return null;
}

function sanitizeDeviceId(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return (candidate || 'prototype-device').slice(0, 128);
}

function sanitizeIdempotencyKey(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (candidate.length < 8 || candidate.length > 160) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(candidate)) return null;
  return candidate;
}

function canonicalRequestHash(body) {
  const query = body.query;
  const origin = body.origin;
  return sha256Hex(JSON.stringify({
    category: query.category,
    travelMode: query.travelMode,
    maxMinutes: Number(query.maxMinutes),
    minimumRating: Number(query.minimumRating),
    minimumReviews: Number(query.minimumReviews),
    openNow: Boolean(query.openNow),
    openForMinutes: Number(query.openForMinutes),
    latitude: Number(origin.latitude),
    longitude: Number(origin.longitude),
  }));
}

function firstRow(payload) {
  return Array.isArray(payload) ? payload[0] : payload;
}

async function reserveCost(entitlementHash, deviceId, idempotencyKey, requestHash) {
  return firstRow(await supabaseRpc('reserve_wallet_api_cost', {
    p_entitlement_hash: entitlementHash,
    p_device_id: deviceId,
    p_service: COST_SERVICE,
    p_estimated_units: RESERVED_COST_UNITS,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  }));
}

async function finishReservation(reservationId, outcome, actualUnits, responsePayload = null, errorCode = null) {
  if (!reservationId) return false;
  const payload = await supabaseRpc('finish_wallet_api_cost_reservation', {
    p_reservation_id: reservationId,
    p_outcome: outcome,
    p_actual_units: actualUnits,
    p_response_payload: responsePayload,
    p_error_code: errorCode,
  });
  const value = firstRow(payload);
  return value === true || value?.finish_wallet_api_cost_reservation === true;
}

function radiusFor(query) {
  const raw = RADIUS_METERS_PER_MINUTE[query.travelMode] * Number(query.maxMinutes);
  return Math.min(50000, Math.max(500, raw));
}

function restrictionRectangle(origin, radiusMeters) {
  const latitudeDelta = radiusMeters / 111320;
  const cosLatitude = Math.max(0.1, Math.cos((origin.latitude * Math.PI) / 180));
  const longitudeDelta = radiusMeters / (111320 * cosLatitude);
  return {
    low: {
      latitude: Math.max(-90, origin.latitude - latitudeDelta),
      longitude: Math.max(-180, origin.longitude - longitudeDelta),
    },
    high: {
      latitude: Math.min(90, origin.latitude + latitudeDelta),
      longitude: Math.min(180, origin.longitude + longitudeDelta),
    },
  };
}

function safeGoogleMinRating(minimumRating) {
  return Math.floor(Number(minimumRating) * 2) / 2;
}

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

function mapGooglePlace(place, routingSummary, origin, query) {
  const seconds = parseDurationSeconds(routingSummary?.legs?.[0]?.duration);
  if (seconds === null) return null;
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const travelMinutes = Math.ceil(seconds / 60);
  const distanceMeters = Number(routingSummary?.legs?.[0]?.distanceMeters ?? 0);
  const price = priceInfo(place.priceLevel);
  const open = place.currentOpeningHours?.openNow === true;
  const closesInMinutes = closingMinutes(place.currentOpeningHours);
  const unknownModeMinutes = 9999;

  return {
    id: String(place.id ?? ''),
    name: String(place.displayName?.text ?? ''),
    category: query.category,
    walkMinutes: query.travelMode === 'Walk' ? travelMinutes : unknownModeMinutes,
    driveMinutes: query.travelMode === 'Drive' ? travelMinutes : unknownModeMinutes,
    bikeMinutes: query.travelMode === 'Bike' ? travelMinutes : unknownModeMinutes,
    distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : 0,
    rating: Number(place.rating ?? 0),
    reviewCount: Number(place.userRatingCount ?? 0),
    priceLevel: price.level,
    price: price.label,
    open,
    closesInMinutes,
    address: String(place.formattedAddress ?? ''),
    phone: '',
    website: '',
    highlights: [],
    latitudeOffset: latitude - origin.latitude,
    longitudeOffset: longitude - origin.longitude,
  };
}

function applyHardFilters(places, query) {
  const timeKey = query.travelMode === 'Walk' ? 'walkMinutes' : query.travelMode === 'Drive' ? 'driveMinutes' : 'bikeMinutes';
  return places.filter((place) => {
    if (place[timeKey] > Number(query.maxMinutes)) return false;
    if (place.rating < Number(query.minimumRating)) return false;
    if (place.reviewCount < Number(query.minimumReviews)) return false;
    if (query.openNow && !place.open) return false;
    if (Number(query.openForMinutes) > 0 && place.closesInMinutes < Number(query.openForMinutes)) return false;
    return true;
  });
}

function sortByTravelTime(places, query) {
  const timeKey = query.travelMode === 'Walk' ? 'walkMinutes' : query.travelMode === 'Drive' ? 'driveMinutes' : 'bikeMinutes';
  return [...places].sort((a, b) => a[timeKey] - b[timeKey] || a.distanceMeters - b.distanceMeters);
}

function buildTextSearchBody(query, origin, pageToken) {
  const body = {
    textQuery: CATEGORY_TO_TEXT_QUERY[query.category],
    includedType: CATEGORY_TO_GOOGLE_TYPE[query.category],
    strictTypeFiltering: true,
    pageSize: 20,
    rankPreference: 'DISTANCE',
    locationRestriction: { rectangle: restrictionRectangle(origin, radiusFor(query)) },
    minRating: safeGoogleMinRating(query.minimumRating),
    openNow: Boolean(query.openNow || Number(query.openForMinutes) > 0),
    routingParameters: {
      origin,
      travelMode: TRAVEL_MODE_TO_GOOGLE[query.travelMode],
    },
  };
  if (pageToken) body.pageToken = pageToken;
  return body;
}

async function googleTextSearchPage(query, origin, pageToken) {
  const response = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': requiredEnv('GOOGLE_PLACES_SERVER_API_KEY'),
      'X-Goog-FieldMask': [
        'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
        'places.rating', 'places.userRatingCount', 'places.priceLevel',
        'places.currentOpeningHours', 'routingSummaries', 'nextPageToken',
      ].join(','),
    },
    body: JSON.stringify(buildTextSearchBody(query, origin, pageToken)),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google Places request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return response.json();
}

async function collectCandidatePages(query, origin, onSuccessfulCall) {
  const byId = new Map();
  let pageToken;
  let providerCalls = 0;
  let providerHasMore = false;

  for (let page = 0; page < MAX_PROVIDER_CALLS_PER_SEARCH; page += 1) {
    const payload = await googleTextSearchPage(query, origin, pageToken);
    providerCalls += 1;
    onSuccessfulCall();
    const rawPlaces = Array.isArray(payload.places) ? payload.places : [];
    const routingSummaries = Array.isArray(payload.routingSummaries) ? payload.routingSummaries : [];
    rawPlaces.forEach((place, index) => {
      const mapped = mapGooglePlace(place, routingSummaries[index], origin, query);
      if (mapped?.id) byId.set(mapped.id, mapped);
    });
    pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken ? payload.nextPageToken : undefined;
    if (!pageToken) {
      providerHasMore = false;
      break;
    }
    providerHasMore = page === MAX_PROVIDER_CALLS_PER_SEARCH - 1;
  }

  return { candidates: [...byId.values()], providerCalls, providerHasMore };
}

function blockedStatus(reason) {
  if (reason === 'wallet_quota_exhausted') return 402;
  if (reason === 'wallet_not_found' || reason === 'entitlement_inactive') return 403;
  if (reason === 'request_in_progress' || reason === 'idempotency_conflict' || reason === 'previous_attempt_failed') return 409;
  if (reason === 'external_calls_disabled' || reason === 'kill_switch_active') return 503;
  return 429;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const validationError = validateRequest(req.body);
  if (validationError) return send(res, 400, { error: validationError });

  const idempotencyKey = sanitizeIdempotencyKey(req.headers['x-neartime-idempotency-key']);
  if (!idempotencyKey) return send(res, 400, { error: 'invalid_idempotency_key' });

  const rawSession = typeof req.headers['x-neartime-entitlement-session'] === 'string'
    ? req.headers['x-neartime-entitlement-session']
    : '';
  if (!rawSession) return send(res, 401, { error: 'subscription_verification_required' });

  const deviceId = sanitizeDeviceId(req.headers['x-neartime-device-id']);
  let reservationId = null;
  let successfulProviderCalls = 0;
  let reservationFinalized = false;

  try {
    const session = await resolveEntitlementSession(rawSession);
    if (!session) return send(res, 401, { error: 'invalid_or_expired_entitlement_session' });

    const decision = await reserveCost(
      session.entitlementHash,
      deviceId,
      idempotencyKey,
      canonicalRequestHash(req.body),
    );
    if (!decision || typeof decision.allowed !== 'boolean') {
      throw new Error('Cost ledger returned an invalid reservation decision.');
    }

    if (!decision.allowed) {
      if (decision.reason === 'idempotent_replay' && decision.replay_response) {
        return send(res, 200, decision.replay_response);
      }
      return send(res, blockedStatus(decision.reason), {
        error: decision.reason === 'wallet_quota_exhausted' ? 'usage_quota_exhausted' : 'external_search_blocked',
        reason: decision.reason,
      });
    }

    reservationId = decision.reservation_id;
    if (!reservationId) throw new Error('Cost gate allowed a call without a reservation id.');

    const collection = await collectCandidatePages(req.body.query, req.body.origin, () => {
      successfulProviderCalls += 1;
    });
    const qualified = applyHardFilters(collection.candidates, req.body.query);
    const places = sortByTravelTime(qualified, req.body.query).slice(0, RESULT_LIMIT);
    const payload = {
      places,
      provider: 'google-places-text-search-new',
      billingSku: COST_SERVICE,
      costUnits: successfulProviderCalls,
      candidateCount: collection.candidates.length,
      qualifiedCount: qualified.length,
      providerResultLimitReached: collection.providerHasMore,
    };

    const committed = await finishReservation(reservationId, 'succeeded', successfulProviderCalls, payload, null);
    if (!committed) throw new Error('External calls completed but the wallet reservation could not be committed.');
    reservationFinalized = true;
    return send(res, 200, payload);
  } catch (error) {
    if (reservationId && !reservationFinalized) {
      try {
        if (successfulProviderCalls > 0) {
          await finishReservation(reservationId, 'failed', successfulProviderCalls, null, 'live_search_failed');
        } else {
          await finishReservation(reservationId, 'released', 0, null, 'live_search_failed');
        }
      } catch {
        // A stale reservation remains conservatively counted until expiry if reconciliation fails.
      }
    }
    console.error('NearTime live search failed', error instanceof Error ? error.message : error);
    return send(res, 502, { error: 'live_search_failed' });
  }
};
