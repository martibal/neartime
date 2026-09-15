'use strict';

const ISOCHRONE_ENDPOINT = 'https://isochrones.googleapis.com/v1/isochrones:generate';
const PROVIDER_VERSION = 'google-isochrones-preview-v1';
const MAX_AGGREGATE_POLYGON_VERTICES = 7000;

function codedError(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  return error;
}

function modeToGoogle(mode) {
  if (mode === 'Walk') return 'WALK';
  if (mode === 'Bike') return 'BICYCLE';
  if (mode === 'Drive') return 'DRIVE';
  throw codedError('isochrone_invalid_travel_mode');
}

function routingPreference(mode) {
  // Google only supports traffic-aware isochrones for motorized modes.
  return mode === 'Drive' ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE';
}

function ringSignedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x1 * y2) - (x2 * y1);
  }
  return sum / 2;
}

function normalizeExteriorRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) throw codedError('isochrone_invalid_ring');
  let normalized = ring.map((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) throw codedError('isochrone_invalid_coordinate');
    const longitude = Number(pair[0]);
    const latitude = Number(pair[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw codedError('isochrone_invalid_coordinate');
    return [longitude, latitude];
  });

  const first = normalized[0];
  const last = normalized[normalized.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) normalized = [...normalized, [...first]];

  // Places Aggregate requires counter-clockwise exterior vertices.
  if (ringSignedArea(normalized) < 0) {
    const open = normalized.slice(0, -1).reverse();
    normalized = [...open, [...open[0]]];
  }

  if (normalized.length > MAX_AGGREGATE_POLYGON_VERTICES) {
    throw codedError('isochrone_polygon_too_many_vertices', String(normalized.length));
  }

  return normalized.map(([longitude, latitude]) => ({ latitude, longitude }));
}

function aggregatePolygonsFromGeoJson(geoJson) {
  if (!geoJson || geoJson.type !== 'MultiPolygon' || !Array.isArray(geoJson.coordinates)) {
    throw codedError('isochrone_invalid_geojson');
  }

  const polygons = [];
  let discardedHoleCount = 0;
  for (const polygon of geoJson.coordinates) {
    if (!Array.isArray(polygon) || polygon.length === 0) continue;
    // Aggregate accepts one simple custom polygon. Keep the exterior shell and
    // deliberately discard holes. This creates a coverage-safe superset: it can
    // add candidates, but it cannot remove candidates reachable in the isochrone.
    polygons.push(normalizeExteriorRing(polygon[0]));
    discardedHoleCount += Math.max(0, polygon.length - 1);
  }

  if (polygons.length === 0) throw codedError('isochrone_empty_geometry');
  return { polygons, discardedHoleCount };
}

function createGoogleIsochroneEnvelopeProvider({ apiKey, fetchImpl = global.fetch, polygonFidelity = 'MEDIUM' }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw codedError('isochrone_api_key_required');
  if (typeof fetchImpl !== 'function') throw codedError('isochrone_fetch_required');

  return {
    async getEnvelope({ origin, travelMode, maxMinutes }) {
      const latitude = Number(origin?.latitude);
      const longitude = Number(origin?.longitude);
      const minutes = Number(maxMinutes);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw codedError('isochrone_invalid_origin');
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 20) throw codedError('isochrone_invalid_minutes');

      const googleMode = modeToGoogle(travelMode);
      const response = await fetchImpl(ISOCHRONE_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify({
          location: { latitude, longitude },
          travelDuration: `${Math.round(minutes * 60)}s`,
          travelMode: googleMode,
          travelDirection: 'FROM',
          routingPreference: routingPreference(travelMode),
          enableSmoothing: false,
          polygonFidelity,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw codedError('isochrone_provider_failed', `${response.status}:${detail.slice(0, 200)}`);
      }

      const payload = await response.json();
      const geoJson = payload?.isochrone?.geoJson;
      const normalized = aggregatePolygonsFromGeoJson(geoJson);

      return Object.freeze({
        provider: 'google-isochrones',
        version: PROVIDER_VERSION,
        preview: true,
        travelMode,
        maxMinutes: minutes,
        routingPreference: routingPreference(travelMode),
        polygonFidelity,
        polygons: normalized.polygons,
        polygonCount: normalized.polygons.length,
        discardedHoleCount: normalized.discardedHoleCount,
        rawGeoJson: geoJson,
      });
    },
  };
}

module.exports = {
  ISOCHRONE_ENDPOINT,
  MAX_AGGREGATE_POLYGON_VERTICES,
  PROVIDER_VERSION,
  aggregatePolygonsFromGeoJson,
  createGoogleIsochroneEnvelopeProvider,
  routingPreference,
};
