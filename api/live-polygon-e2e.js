'use strict';

const { createGoogleIsochroneEnvelopeProvider } = require('./lib/googleIsochroneEnvelopeProvider');
const { createGoogleCoverageProvider } = require('./lib/googleCoverageProvider');
const { proveTopKByRating } = require('./lib/topKRatingPlanner');

function toLonLatRing(points) {
  return points.map((point) => [Number(point.longitude), Number(point.latitude)]);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = String(process.env.GOOGLE_PLACES_SERVER_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'google_api_key_not_configured' });

  const origin = { latitude: 59.9139, longitude: 10.7522 };
  const travelMode = 'Walk';
  const maxMinutes = 20;
  const includedTypes = ['restaurant'];
  const k = 20;

  try {
    const envelopeProvider = createGoogleIsochroneEnvelopeProvider({ apiKey, fetchImpl: global.fetch });
    const envelope = await envelopeProvider.getEnvelope({ origin, travelMode, maxMinutes });

    if (envelope.discardedHoleCount > 0) {
      return res.status(200).json({
        status: 'DEGRADED',
        reason: 'isochrone_holes_not_supported_exactly',
        polygonCount: envelope.polygonCount,
        discardedHoleCount: envelope.discardedHoleCount,
        travelMode,
        maxMinutes,
        includedTypes,
      });
    }

    if (envelope.polygonCount !== 1) {
      return res.status(200).json({
        status: 'DEGRADED',
        reason: 'live_top_k_probe_requires_single_polygon',
        polygonCount: envelope.polygonCount,
        discardedHoleCount: envelope.discardedHoleCount,
        travelMode,
        maxMinutes,
        includedTypes,
      });
    }

    const polygon = toLonLatRing(envelope.polygons[0]);
    const google = createGoogleCoverageProvider({ apiKey, origin, travelMode, fetchImpl: global.fetch });
    const result = await proveTopKByRating({
      polygon,
      includedTypes,
      aggregateSearch: google.aggregateSearch,
      placeDetails: google.placeDetails,
      k,
      maxCandidateDetails: 100,
    });

    return res.status(200).json({
      status: result.status,
      reason: result.reason,
      k,
      returned: Array.isArray(result.topK) ? result.topK.length : 0,
      candidateCount: result.candidateCount ?? null,
      selectedThreshold: result.selectedThreshold ?? null,
      aggregateCalls: result.aggregateCalls,
      detailCalls: result.detailCalls,
      diagnostics: result.diagnostics,
      proof: result.proof || null,
      polygonCount: envelope.polygonCount,
      discardedHoleCount: envelope.discardedHoleCount,
      envelopeProvider: envelope.provider,
      envelopeVersion: envelope.version,
      travelMode,
      maxMinutes,
      includedTypes,
    });
  } catch (error) {
    return res.status(500).json({ error: error?.code || error?.message || 'live_top_k_rating_e2e_failed' });
  }
};
