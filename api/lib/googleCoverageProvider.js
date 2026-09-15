'use strict';

const AGGREGATE_ENDPOINT = 'https://areainsights.googleapis.com/v1:computeInsights';
const NEARBY_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';
const PLACE_DETAILS_BASE = 'https://places.googleapis.com/v1/places';
const AGGREGATE_MAX_POLYGON_VERTICES = 7000;

const SKU = Object.freeze({
  AGGREGATE: '546C-66B2-E5A6',
  NEARBY_ENTERPRISE_ATMOSPHERE: 'F20E-7034-0EF7',
  PLACE_DETAILS_ENTERPRISE: '2D9A-3DE0-3766',
});

const NEARBY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours',
  'routingSummaries',
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'priceLevel',
  'currentOpeningHours',
].join(',');

function normalizeTravelMode(value) {
  const map = { Walk: 'WALK', Drive: 'DRIVE', Bike: 'BICYCLE', WALK: 'WALK', DRIVE: 'DRIVE', BICYCLE: 'BICYCLE' };
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

function signedRingArea(ring) {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    sum += (x1 * y2) - (x2 * y1);
  }
  return sum / 2;
}

function validatePolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 4) throw new Error('invalid_polygon_ring');
  if (polygon.length > AGGREGATE_MAX_POLYGON_VERTICES) throw new Error('aggregate_polygon_vertex_limit_exceeded');

  const ring = polygon.map((point) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error('invalid_polygon_coordinate');
    const longitude = Number(point[0]);
    const latitude = Number(point[1]);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('invalid_polygon_latitude');
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('invalid_polygon_longitude');
    return [longitude, latitude];
  });

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('polygon_must_be_closed');

  const unique = new Set(ring.slice(0, -1).map(([longitude, latitude]) => `${longitude}:${latitude}`));
  if (unique.size < 3) throw new Error('polygon_requires_three_unique_vertices');

  for (let index = 1; index < ring.length; index += 1) {
    if (ring[index][0] === ring[index - 1][0] && ring[index][1] === ring[index - 1][1]) {
      throw new Error('polygon_has_consecutive_duplicate_vertices');
    }
  }

  if (signedRingArea(ring) < 0) {
    const open = ring.slice(0, -1).reverse();
    open.push([...open[0]]);
    return open;
  }

  return ring;
}

function validateTypes(includedTypes) {
  if (!Array.isArray(includedTypes) || includedTypes.length === 0) throw new Error('invalid_included_types');
  const types = [...new Set(includedTypes.map((value) => String(value || '').trim()).filter(Boolean))];
  if (types.length === 0) throw new Error('invalid_included_types');
  return types;
}

async function parseJsonResponse(response, label) {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`${label}_failed_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function createGoogleCoverageProvider({ apiKey, origin, travelMode, fetchImpl = global.fetch }) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('google_api_key_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_required');
  const routeOrigin = {
    latitude: Number(origin?.latitude),
    longitude: Number(origin?.longitude),
  };
  if (!Number.isFinite(routeOrigin.latitude) || !Number.isFinite(routeOrigin.longitude)) throw new Error('invalid_origin');
  const googleTravelMode = normalizeTravelMode(travelMode);

  async function aggregateSearch({ circle, polygon, includedTypes, includePlaceIds }) {
    if (Boolean(circle) === Boolean(polygon)) throw new Error('aggregate_requires_exactly_one_location_shape');
    const types = validateTypes(includedTypes);
    const insights = includePlaceIds ? ['INSIGHT_COUNT', 'INSIGHT_PLACES'] : ['INSIGHT_COUNT'];

    let locationFilter;
    if (polygon) {
      const safePolygon = validatePolygon(polygon);
      locationFilter = {
        customArea: {
          polygon: {
            coordinates: safePolygon.map(([longitude, latitude]) => ({ latitude, longitude })),
          },
        },
      };
    } else {
      const safeCircle = validateCircle(circle);
      locationFilter = {
        circle: {
          latLng: safeCircle.center,
          radius: safeCircle.radius,
        },
      };
    }

    const response = await fetchImpl(AGGREGATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
      },
      body: JSON.stringify({
        insights,
        filter: {
          locationFilter,
          typeFilter: { includedTypes: types },
          operatingStatus: ['OPERATING_STATUS_OPERATIONAL'],
        },
      }),
    });
    const payload = await parseJsonResponse(response, 'google_aggregate');
    const count = Number(payload?.count);
    if (!Number.isInteger(count) || count < 0) throw new Error('invalid_google_aggregate_count');
    const placeIds = Array.isArray(payload?.placeInsights)
      ? payload.placeInsights.map((entry) => entry?.place).filter(Boolean)
      : [];
    return { count, placeIds, placeInsights: payload?.placeInsights || [] };
  }

  async function nearbySearch({ circle, includedTypes, maxResultCount = 20 }) {
    const safeCircle = validateCircle(circle);
    const types = validateTypes(includedTypes);
    const body = {
      includedTypes: types,
      maxResultCount: Math.min(20, Math.max(1, Number(maxResultCount) || 20)),
      rankPreference: 'DISTANCE',
      locationRestriction: { circle: safeCircle },
      routingParameters: {
        origin: routeOrigin,
        travelMode: googleTravelMode,
        ...(googleTravelMode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE_OPTIMAL' } : {}),
      },
    };
    const response = await fetchImpl(NEARBY_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': NEARBY_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    return parseJsonResponse(response, 'google_nearby');
  }

  async function placeDetails({ placeId }) {
    const id = String(placeId || '').trim().replace(/^places\//, '');
    if (!id) throw new Error('invalid_place_id');
    const response = await fetchImpl(`${PLACE_DETAILS_BASE}/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': DETAILS_FIELD_MASK,
      },
    });
    return parseJsonResponse(response, 'google_place_details');
  }

  return {
    aggregateSearch,
    nearbySearch,
    placeDetails,
    sku: SKU,
  };
}

module.exports = {
  AGGREGATE_ENDPOINT,
  AGGREGATE_MAX_POLYGON_VERTICES,
  DETAILS_FIELD_MASK,
  NEARBY_ENDPOINT,
  NEARBY_FIELD_MASK,
  PLACE_DETAILS_BASE,
  SKU,
  createGoogleCoverageProvider,
  normalizeTravelMode,
  validatePolygon,
};
