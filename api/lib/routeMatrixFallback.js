'use strict';

const ROUTE_MATRIX_ENDPOINT = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

const ROUTE_MATRIX_SKU = Object.freeze({
  ESSENTIALS: '9392-1087-2045',
  PRO: '2E25-887A-DAD4',
});

function normalizeTravelMode(value) {
  const map = {
    Walk: 'WALK',
    Drive: 'DRIVE',
    Bike: 'BICYCLE',
    WALK: 'WALK',
    DRIVE: 'DRIVE',
    BICYCLE: 'BICYCLE',
  };
  const mode = map[value];
  if (!mode) throw new Error('invalid_travel_mode');
  return mode;
}

function routeMatrixSkuForTravelMode(value) {
  return normalizeTravelMode(value) === 'DRIVE'
    ? ROUTE_MATRIX_SKU.PRO
    : ROUTE_MATRIX_SKU.ESSENTIALS;
}

function normalizePlaceId(value) {
  const id = String(value || '').trim().replace(/^places\//, '');
  if (!id) throw new Error('invalid_place_id');
  return id;
}

function validateOrigin(origin) {
  const latitude = Number(origin?.latitude);
  const longitude = Number(origin?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('invalid_origin_latitude');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('invalid_origin_longitude');
  return { latitude, longitude };
}

async function parseRouteMatrixResponse(response) {
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`google_route_matrix_failed_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error('invalid_route_matrix_response');
  const element = payload[0];
  const statusCode = Number(element?.status?.code ?? 0);
  if (statusCode !== 0) throw new Error(`route_matrix_element_status_${statusCode}`);
  if (element?.condition !== 'ROUTE_EXISTS') throw new Error('route_matrix_route_not_found');
  if (typeof element?.duration !== 'string') throw new Error('route_matrix_duration_missing');
  return element;
}

function createRouteMatrixFallback({ apiKey, origin, travelMode, fetchImpl = global.fetch }) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('google_api_key_required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch_required');
  const safeOrigin = validateOrigin(origin);
  const mode = normalizeTravelMode(travelMode);
  const skuId = routeMatrixSkuForTravelMode(mode);

  async function compute({ placeId }) {
    const id = normalizePlaceId(placeId);
    const body = {
      origins: [{ waypoint: { location: { latLng: safeOrigin } } }],
      destinations: [{ waypoint: { placeId: id } }],
      travelMode: mode,
      ...(mode === 'DRIVE' ? { routingPreference: 'TRAFFIC_AWARE_OPTIMAL' } : {}),
    };

    const response = await fetchImpl(ROUTE_MATRIX_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,distanceMeters,duration',
      },
      body: JSON.stringify(body),
    });
    const element = await parseRouteMatrixResponse(response);
    return {
      skuId,
      quantity: 1,
      routingSummary: {
        legs: [{
          duration: element.duration,
          distanceMeters: Number(element.distanceMeters ?? 0),
        }],
      },
    };
  }

  return { compute, skuId };
}

async function enrichFallbackPlaceWithRoute({
  place,
  placeId,
  searchKey,
  hooks,
  routeMatrix,
}) {
  if (!place) return null;
  if (!hooks?.beforeProviderCall || !hooks?.afterProviderCall) throw new Error('provider_cogs_hooks_required');
  if (!routeMatrix?.compute || !routeMatrix?.skuId) throw new Error('route_matrix_required');

  const id = normalizePlaceId(placeId ?? place.id ?? place.name);
  const descriptor = {
    kind: 'route_matrix',
    skuId: routeMatrix.skuId,
    quantity: 1,
    idempotencyKey: `${searchKey}:route-matrix:${id}`,
    placeId: id,
  };
  const reservation = await hooks.beforeProviderCall(descriptor);
  try {
    const route = await routeMatrix.compute({ placeId: id });
    await hooks.afterProviderCall({ ...descriptor, reservation, outcome: 'succeeded' });
    return { ...place, __routingSummary: route.routingSummary };
  } catch (error) {
    await hooks.afterProviderCall({ ...descriptor, reservation, outcome: 'failed', error });
    throw error;
  }
}

module.exports = {
  ROUTE_MATRIX_ENDPOINT,
  ROUTE_MATRIX_SKU,
  createRouteMatrixFallback,
  enrichFallbackPlaceWithRoute,
  normalizeTravelMode,
  routeMatrixSkuForTravelMode,
};
