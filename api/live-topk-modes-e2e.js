'use strict';

const { createGoogleIsochroneEnvelopeProvider } = require('./lib/googleIsochroneEnvelopeProvider');
const { createGoogleCoverageProvider } = require('./lib/googleCoverageProvider');
const { createRouteMatrixFallback } = require('./lib/routeMatrixFallback');
const { proveTopK, RANKING_MODE } = require('./lib/topKProofPlanner');

function toLonLatRing(points) {
  return points.map((point) => [Number(point.longitude), Number(point.latitude)]);
}

function summarize(result) {
  return {
    status: result.status,
    rankingMode: result.rankingMode,
    reason: result.reason,
    returned: Array.isArray(result.topK) ? result.topK.length : 0,
    candidateCount: result.candidateCount ?? null,
    selectedThreshold: result.selectedThreshold ?? null,
    selectedThresholdMinutes: result.selectedThresholdMinutes ?? null,
    aggregateCalls: result.aggregateCalls ?? 0,
    detailCalls: result.detailCalls ?? 0,
    envelopeCalls: result.envelopeCalls ?? 0,
    routeCalls: result.routeCalls ?? 0,
    diagnostics: result.diagnostics || [],
    proof: result.proof || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  res.setHeader('x-robots-tag', 'noindex');

  const apiKey = String(process.env.GOOGLE_PLACES_SERVER_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'google_api_key_not_configured' });

  const origin = { latitude: 59.9139, longitude: 10.7522 };
  const travelMode = 'Walk';
  const maxMinutes = 10;
  const includedTypes = ['cafe'];
  const k = 20;

  try {
    const envelopeProvider = createGoogleIsochroneEnvelopeProvider({ apiKey, fetchImpl: global.fetch });
    const google = createGoogleCoverageProvider({ apiKey, origin, travelMode, fetchImpl: global.fetch });
    const routeMatrix = createRouteMatrixFallback({ apiKey, origin, travelMode, fetchImpl: global.fetch });

    const envelope = await envelopeProvider.getEnvelope({ origin, travelMode, maxMinutes });
    if (Number(envelope.discardedHoleCount || 0) > 0 || Number(envelope.polygonCount) !== 1) {
      return res.status(200).json({
        status: 'DEGRADED',
        reason: 'base_envelope_not_simple_exact',
        polygonCount: envelope.polygonCount,
        discardedHoleCount: envelope.discardedHoleCount,
      });
    }
    const polygon = toLonLatRing(envelope.polygons[0]);

    const rating = await proveTopK({
      rankingMode: RANKING_MODE.RATING,
      polygon,
      includedTypes,
      aggregateSearch: google.aggregateSearch,
      placeDetails: google.placeDetails,
      k,
      maxCandidateDetails: 100,
    });

    const price = await proveTopK({
      rankingMode: RANKING_MODE.PRICE,
      polygon,
      includedTypes,
      aggregateSearch: google.aggregateSearch,
      k,
      maxCandidatesPerPriceBucket: 100,
    });

    const travelTime = await proveTopK({
      rankingMode: RANKING_MODE.TRAVEL_TIME,
      envelopeProvider,
      aggregateSearch: google.aggregateSearch,
      routeMatrixCompute: routeMatrix.compute,
      origin,
      travelMode,
      maxMinutes,
      includedTypes,
      k,
      maxCandidateRoutes: 100,
      maxRouteCalls: 100,
    });

    return res.status(200).json({
      scenario: { origin: 'generic-oslo', travelMode, maxMinutes, includedTypes, k },
      baseEnvelope: {
        provider: envelope.provider,
        version: envelope.version,
        polygonCount: envelope.polygonCount,
        discardedHoleCount: envelope.discardedHoleCount,
      },
      results: {
        rating: summarize(rating),
        price: summarize(price),
        travelTime: summarize(travelTime),
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error?.code || error?.message || 'live_topk_modes_e2e_failed' });
  }
};
