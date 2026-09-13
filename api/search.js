const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const COST_SERVICE = 'places-nearby-enterprise-atmosphere';
const COST_UNITS_PER_SEARCH = 1;

const CATEGORY_TO_GOOGLE_TYPE = {
  Restaurant: 'restaurant',
  Cafe: 'cafe',
  Grocery: 'grocery_store',
  Pharmacy: 'pharmacy',
  Parking: 'parking',
};

const TRAVEL_MODE_TO_GOOGLE = {
  Walk: 'WALK',
  Drive: 'DRIVE',
  Bike: 'BICYCLE',
};

const RADIUS_METERS_PER_MINUTE = {
  Walk: 120,
  Bike: 350,
  Drive: 1000,
};

const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: { level: 0, label: 'Free' },
  PRICE_LEVEL_INEXPENSIVE: { level: 1, label: '$' },
  PRICE_LEVEL_MODERATE: { level: 2, label: '$$' },
  PRICE_LEVEL_EXPENSIVE: { level: 3, label: '$$$' },
  PRICE_LEVEL_VERY_EXPENSIVE: { level: 4, label: '$$$$' },
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

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

async function supabaseRpc(functionName, body) {
  const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Cost ledger RPC ${functionName} failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function reserveCost(deviceId) {
  const payload = await supabaseRpc('reserve_api_cost', {
    p_device_id: deviceId,
    p_service: COST_SERVICE,
    p_estimated_units: COST_UNITS_PER_SEARCH,
  });
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row.allowed !== 'boolean') {
    throw new Error('Cost ledger returned an invalid reservation decision.');
  }
  return row;
}

async function finishReservation(reservationId, status) {
  if (!reservationId) return false;
  const payload = await supabaseRpc('finish_api_cost_reservation', {
    p_reservation_id: reservationId,
    p_status: status,
  });
  const value = Array.isArray(payload) ? payload[0] : payload;
  return value === true || value?.finish_api_cost_reservation === true;
}

function radiusFor(query) {
  const raw = RADIUS_METERS_PER_MINUTE[query.travelMode] * Number(query.maxMinutes);
  return Math.min(50000, Math.max(500, raw));
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

  const travelMinutes = Math.ceil(seconds / 60);
  const distanceMeters = Number(routingSummary?.legs?.[0]?.distanceMeters ?? 0);
  const price = priceInfo(place.priceLevel);
  const open = place.currentOpeningHours?.openNow === true;
  const closesInMinutes = closingMinutes(place.currentOpeningHours);
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

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

function sortPlaces(places, sortKey, query) {
  const copy = [...places];
  const timeKey = query.travelMode === 'Walk' ? 'walkMinutes' : query.travelMode === 'Drive' ? 'driveMinutes' : 'bikeMinutes';
  copy.sort((a, b) => {
    switch (sortKey) {
      case 'rating': return b.rating - a.rating || a[timeKey] - b[timeKey];
      case 'distance': return a.distanceMeters - b.distanceMeters;
      case 'price': return a.priceLevel - b.priceLevel || a[timeKey] - b[timeKey];
      case 'reviews': return b.reviewCount - a.reviewCount || a[timeKey] - b[timeKey];
      case 'open': return b.closesInMinutes - a.closesInMinutes || a[timeKey] - b[timeKey];
      case 'time':
      default: return a[timeKey] - b[timeKey];
    }
  });
  return copy;
}

async function googleNearbySearch(query, origin) {
  const apiKey = requiredEnv('GOOGLE_PLACES_SERVER_API_KEY');
  const response = await fetch(PLACES_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.currentOpeningHours',
        'routingSummaries',
      ].join(','),
    },
    body: JSON.stringify({
      includedTypes: [CATEGORY_TO_GOOGLE_TYPE[query.category]],
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: origin,
          radius: radiusFor(query),
        },
      },
      routingParameters: {
        origin,
        travelMode: TRAVEL_MODE_TO_GOOGLE[query.travelMode],
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google Places request failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const validationError = validateRequest(req.body);
  if (validationError) return send(res, 400, { error: validationError });

  const deviceId = sanitizeDeviceId(req.headers['x-neartime-device-id']);
  let reservationId = null;
  let googleCallSucceeded = false;

  try {
    const decision = await reserveCost(deviceId);
    if (!decision.allowed) {
      const status = decision.reason === 'kill_switch_active' || decision.reason === 'external_calls_disabled' ? 503 : 429;
      return send(res, status, { error: 'external_search_blocked', reason: decision.reason });
    }

    reservationId = decision.reservation_id;
    if (!reservationId) throw new Error('Cost gate allowed a call without a reservation id.');

    const googlePayload = await googleNearbySearch(req.body.query, req.body.origin);
    googleCallSucceeded = true;

    const rawPlaces = Array.isArray(googlePayload.places) ? googlePayload.places : [];
    const routingSummaries = Array.isArray(googlePayload.routingSummaries) ? googlePayload.routingSummaries : [];
    const mapped = rawPlaces
      .map((place, index) => mapGooglePlace(place, routingSummaries[index], req.body.origin, req.body.query))
      .filter(Boolean);
    const places = sortPlaces(applyHardFilters(mapped, req.body.query), req.body.sortKey, req.body.query);

    const committed = await finishReservation(reservationId, 'committed');
    if (!committed) throw new Error('External call completed but the cost reservation could not be committed.');

    return send(res, 200, {
      places,
      provider: 'google-places-nearby-new',
      billingSku: COST_SERVICE,
      costUnits: COST_UNITS_PER_SEARCH,
    });
  } catch (error) {
    if (reservationId) {
      try {
        await finishReservation(reservationId, googleCallSucceeded ? 'committed' : 'released');
      } catch {
        // Keep the original error. A stale reserved row remains conservatively counted until expiry.
      }
    }
    console.error('NearTime live search failed', error);
    return send(res, 502, { error: 'live_search_failed' });
  }
};
