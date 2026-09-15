'use strict';

const { createGoogleIsochroneEnvelopeProvider } = require('./lib/googleIsochroneEnvelopeProvider');
const { createGoogleCoverageProvider } = require('./lib/googleCoverageProvider');
const { runPolygonCoveragePath } = require('./lib/polygonCoveragePath');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = String(process.env.GOOGLE_PLACES_SERVER_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'google_api_key_not_configured' });

  const origin = { latitude: 59.9139, longitude: 10.7522 };
  const travelMode = 'Walk';
  const maxMinutes = 10;
  const includedTypes = ['cafe'];

  try {
    const envelopeProvider = createGoogleIsochroneEnvelopeProvider({ apiKey, fetchImpl: global.fetch });
    const google = createGoogleCoverageProvider({ apiKey, origin, travelMode, fetchImpl: global.fetch });

    const result = await runPolygonCoveragePath({
      envelopeProvider,
      aggregateSearch: google.aggregateSearch,
      origin,
      travelMode,
      maxMinutes,
      includedTypes,
      searchKey: 'live-polygon-e2e-oslo-20260915',
      enumerationOptions: {
        maxIdsPerPolygon: 100,
        maxDepth: 4,
        maxAggregateCalls: 6,
      },
    });

    return res.status(200).json({
      verified: result.verified,
      reason: result.reason,
      expectedCount: result.expectedCount,
      retrievedCount: Array.isArray(result.placeIds) ? result.placeIds.length : 0,
      aggregateCalls: result.aggregateCalls,
      polygonCount: result.envelope?.polygonCount ?? null,
      discardedHoleCount: result.envelope?.discardedHoleCount ?? null,
      envelopeProvider: result.envelope?.provider ?? null,
      envelopeVersion: result.envelope?.version ?? null,
      travelMode,
      maxMinutes,
      includedTypes,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.code || error?.message || 'live_polygon_e2e_failed' });
  }
};
