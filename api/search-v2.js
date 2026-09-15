'use strict';

const {
  requiredEnv,
  sha256Hex,
  supabaseRpc,
  resolveEntitlementSession,
} = require('./lib/entitlements');
const { runCoverageSearchV2, CATEGORY_TYPES_V1 } = require('./lib/coverageSearchV2');
const { buildCoverageEnvelope } = require('./lib/coverageGeometry');

const TRAVEL_MODES = new Set(['Walk', 'Drive', 'Bike']);
const RESULT_LIMIT = 20;

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function enabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function sanitize(value, min = 1, max = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length >= min && text.length <= max ? text : null;
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'invalid_body';
  if (!body.query || typeof body.query !== 'object') return 'invalid_query';
  if (!body.origin || typeof body.origin !== 'object') return 'invalid_origin';
  if (!CATEGORY_TYPES_V1[body.query.category]) return 'invalid_category';
  if (!TRAVEL_MODES.has(body.query.travelMode)) return 'invalid_travel_mode';
  if (![5, 10, 15, 20].includes(Number(body.query.maxMinutes))) return 'invalid_max_minutes';
  if (![0, 100, 300, 1000].includes(Number(body.query.minimumReviews))) return 'invalid_minimum_reviews';
  if (![0, 60, 120, 180].includes(Number(body.query.openForMinutes))) return 'invalid_open_for_minutes';
  const rating = Number(body.query.minimumRating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) return 'invalid_minimum_rating';
  const lat = Number(body.origin.latitude);
  const lng = Number(body.origin.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'invalid_latitude';
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'invalid_longitude';
  return null;
}

function canonicalRequestHash(body, geometry) {
  return sha256Hex(JSON.stringify({
    query: {
      category: body.query.category,
      travelMode: body.query.travelMode,
      maxMinutes: Number(body.query.maxMinutes),
      minimumRating: Number(body.query.minimumRating),
      minimumReviews: Number(body.query.minimumReviews),
      openNow: Boolean(body.query.openNow),
      openForMinutes: Number(body.query.openForMinutes),
    },
    origin: {
      latitude: Number(body.origin.latitude),
      longitude: Number(body.origin.longitude),
    },
    coverageGeometry: {
      version: geometry.version,
      radiusMeters: geometry.radiusMeters,
      maxStraightLineKmh: geometry.maxStraightLineKmh,
    },
  }));
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function finishLogical(reservationId, outcome, qualified, payload = null, errorCode = null) {
  if (!reservationId) return null;
  return firstRow(await supabaseRpc('finish_logical_search', {
    p_reservation_id: reservationId,
    p_outcome: outcome,
    p_qualified_result: Boolean(qualified),
    p_response_payload: payload,
    p_error_code: errorCode,
  }));
}

function blockedStatus(reason) {
  if (reason === 'provider_budget_exhausted' || reason === 'paid_search_quota_exhausted') return 402;
  if (reason === 'wallet_not_found' || reason === 'entitlement_inactive' || reason === 'logical_plan_not_configured') return 403;
  if (reason === 'request_in_progress' || reason === 'idempotency_conflict' || reason === 'previous_attempt_failed') return 409;
  if (reason === 'external_calls_disabled' || reason === 'kill_switch_active' || reason === 'coverage_v2_disabled' || reason === 'coverage_geometry_not_verified') return 503;
  return 429;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const v2Enabled = enabled('NEARTIME_COVERAGE_V2_ENABLED');
  const geometryVerified = enabled('NEARTIME_COVERAGE_GEOMETRY_VERIFIED');
  if (!v2Enabled) return send(res, 503, { error: 'coverage_v2_disabled' });
  if (!geometryVerified) return send(res, 503, { error: 'coverage_geometry_not_verified' });

  const validationError = validate(req.body);
  if (validationError) return send(res, 400, { error: validationError });

  let geometry;
  try {
    geometry = buildCoverageEnvelope(req.body.query);
  } catch (error) {
    return send(res, 503, { error: error?.code || 'coverage_geometry_failed' });
  }

  const deviceId = sanitize(req.headers['x-neartime-device-id'], 1, 128);
  const idempotencyKey = sanitize(req.headers['x-neartime-idempotency-key'], 8, 160);
  const rawSession = sanitize(req.headers['x-neartime-entitlement-session'], 8, 512);
  if (!deviceId) return send(res, 400, { error: 'invalid_device_id' });
  if (!idempotencyKey) return send(res, 400, { error: 'invalid_idempotency_key' });
  if (!rawSession) return send(res, 401, { error: 'paid_entitlement_required' });

  let logicalReservationId = null;
  let logicalFinalized = false;
  try {
    const session = await resolveEntitlementSession(rawSession);
    if (!session?.entitlementHash) return send(res, 401, { error: 'invalid_or_expired_entitlement_session' });

    const requestHash = canonicalRequestHash(req.body, geometry);
    const installHash = sha256Hex(`install:${deviceId}`);
    const decision = firstRow(await supabaseRpc('authorize_logical_search', {
      p_install_hash: installHash,
      p_entitlement_hash: session.entitlementHash,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
    }));

    if (!decision || typeof decision.allowed !== 'boolean') throw new Error('invalid_logical_search_decision');
    if (!decision.allowed) {
      if (decision.reason === 'idempotent_replay' && decision.replay_response) {
        return send(res, 200, decision.replay_response);
      }
      return send(res, blockedStatus(decision.reason), { error: decision.reason || 'search_blocked' });
    }

    logicalReservationId = decision.logical_reservation_id;
    if (!logicalReservationId) throw new Error('logical_reservation_missing');

    const result = await runCoverageSearchV2({
      activation: { enabled: true, geometryVerified: true },
      apiKey: requiredEnv('GOOGLE_PLACES_SERVER_API_KEY'),
      entitlementHash: session.entitlementHash,
      deviceId,
      supabaseRpc,
      origin: req.body.origin,
      query: req.body.query,
      radiusMeters: geometry.radiusMeters,
      searchKey: idempotencyKey,
      fetchImpl: global.fetch,
    });

    const places = [...result.places].sort((a, b) => {
      const key = req.body.query.travelMode === 'Walk' ? 'walkMinutes' : req.body.query.travelMode === 'Drive' ? 'driveMinutes' : 'bikeMinutes';
      return a[key] - b[key] || a.distanceMeters - b.distanceMeters;
    }).slice(0, RESULT_LIMIT);

    const payload = {
      places,
      provider: 'google-places-coverage-v2',
      resultStatus: result.resultStatus,
      coverageState: result.coverageState,
      coverageReason: result.coverageReason,
      expectedCount: result.expectedCount,
      retrievedCount: result.retrievedCount,
      candidateCount: result.candidateCount,
      qualifiedCount: result.places.length,
      providerCalls: result.providerCalls,
      coverageGeometry: geometry,
      accessMode: 'paid',
    };

    const contractWritten = await supabaseRpc('set_logical_search_result_contract', {
      p_reservation_id: logicalReservationId,
      p_result_status: result.resultStatus,
      p_coverage_state: result.coverageState,
      p_expected_count: result.expectedCount,
      p_retrieved_count: result.retrievedCount,
      p_coverage_reason: result.coverageReason,
    });
    const contractOk = firstRow(contractWritten);
    if (!(contractOk === true || contractOk?.set_logical_search_result_contract === true)) {
      throw new Error('search_result_contract_write_failed');
    }

    const logicalResult = await finishLogical(logicalReservationId, 'succeeded', places.length > 0, payload, null);
    if (!logicalResult?.finalized) throw new Error('logical_search_finalize_failed');
    logicalFinalized = true;

    return send(res, 200, {
      ...payload,
      remainingSearches: logicalResult.remaining_searches ?? null,
      remainingAttempts: logicalResult.remaining_attempts ?? null,
    });
  } catch (error) {
    const reason = error?.code || error?.message || 'coverage_v2_failed';
    if (logicalReservationId && !logicalFinalized) {
      try {
        await finishLogical(logicalReservationId, 'released', false, null, reason);
      } catch {
        // Reservation expires fail-closed if reconciliation fails.
      }
    }
    if (['provider_budget_exhausted', 'external_calls_disabled', 'kill_switch_active', 'wallet_not_found', 'entitlement_inactive', 'sku_price_not_found'].includes(reason)) {
      return send(res, blockedStatus(reason), { error: reason });
    }
    console.error('NearTime coverage v2 search failed', reason);
    return send(res, 502, { error: 'coverage_v2_failed', reason });
  }
};
