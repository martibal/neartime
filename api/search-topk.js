'use strict';

const {
  requiredEnv,
  sha256Hex,
  supabaseRpc,
  resolveEntitlementSession,
} = require('./lib/entitlements');
const {
  COMPLETE_TOP_K,
} = require('./lib/topKProofPlanner');
const {
  CATEGORY_TYPES,
  normalizeRankingMode,
  runTopKSearchRuntime,
  unsupportedHardFilterReason,
} = require('./lib/topKSearchRuntime');

const TRAVEL_MODES = new Set(['Walk', 'Drive', 'Bike']);
const MAX_MINUTES = new Set([5, 10, 15, 20]);
const MINIMUM_REVIEWS = new Set([0, 100, 300, 1000]);
const OPEN_FOR_MINUTES = new Set([0, 60, 120, 180]);
const PRODUCT_TOP_K = 10;

// The production Top-K route remains feature-gated for ordinary traffic.
// The bounded GitHub Actions live probe may pass the disabled gate only when
// BOTH the exact internal probe device id and the exact pseudonymous test
// entitlement resolve. The probe token itself remains secret and the fixture
// is revoked after every run.
const LIVE_PROBE_DEVICE_ID = 'internal-live-topk-probe';
const LIVE_PROBE_ENTITLEMENT_HASH = '3f4aab5f5f21856ff3f402753a597d494a53eecb91fce35b36d37972f39d5b91';

function enabled(name) {
  return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

function send(res, status, payload) {
  return res.status(status).json(payload);
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function sanitize(value, min = 1, max = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length >= min && text.length <= max ? text : null;
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'invalid_body';
  if (!body.query || typeof body.query !== 'object') return 'invalid_query';
  if (!body.origin || typeof body.origin !== 'object') return 'invalid_origin';
  if (!CATEGORY_TYPES[body.query.category]) return 'invalid_category';
  if (!TRAVEL_MODES.has(body.query.travelMode)) return 'invalid_travel_mode';
  if (!MAX_MINUTES.has(Number(body.query.maxMinutes))) return 'invalid_max_minutes';
  if (!MINIMUM_REVIEWS.has(Number(body.query.minimumReviews || 0))) return 'invalid_minimum_reviews';
  if (!OPEN_FOR_MINUTES.has(Number(body.query.openForMinutes || 0))) return 'invalid_open_for_minutes';
  try {
    normalizeRankingMode(body.query.rankingMode);
  } catch {
    return 'invalid_ranking_mode';
  }
  const rating = Number(body.query.minimumRating || 0);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) return 'invalid_minimum_rating';
  const latitude = Number(body.origin.latitude);
  const longitude = Number(body.origin.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return 'invalid_latitude';
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return 'invalid_longitude';
  return null;
}

function canonicalRequestHash(body) {
  return sha256Hex(JSON.stringify({
    query: {
      category: body.query.category,
      travelMode: body.query.travelMode,
      maxMinutes: Number(body.query.maxMinutes),
      minimumRating: Number(body.query.minimumRating || 0),
      minimumReviews: Number(body.query.minimumReviews || 0),
      openNow: Boolean(body.query.openNow),
      openForMinutes: Number(body.query.openForMinutes || 0),
      rankingMode: normalizeRankingMode(body.query.rankingMode),
    },
    origin: {
      latitude: Number(body.origin.latitude),
      longitude: Number(body.origin.longitude),
    },
  }));
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
  if (reason === 'external_calls_disabled' || reason === 'kill_switch_active' || reason === 'sku_price_not_found') return 503;
  return 429;
}

function canUseDisabledTopKGate({ deviceId, entitlementHash }) {
  return deviceId === LIVE_PROBE_DEVICE_ID && entitlementHash === LIVE_PROBE_ENTITLEMENT_HASH;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const validationError = validate(req.body);
  if (validationError) return send(res, 400, { error: validationError });

  const unsupported = unsupportedHardFilterReason(req.body.query);
  if (unsupported) {
    return send(res, 503, {
      error: 'top_k_filter_proof_not_ready',
      reason: unsupported,
      resultStatus: 'DEGRADED',
    });
  }

  const deviceId = sanitize(req.headers['x-neartime-device-id'], 1, 128);
  const idempotencyKey = sanitize(req.headers['x-neartime-idempotency-key'], 8, 160);
  const rawSession = sanitize(req.headers['x-neartime-entitlement-session'], 8, 512);
  if (!deviceId) return send(res, 400, { error: 'invalid_device_id' });
  if (!idempotencyKey) return send(res, 400, { error: 'invalid_idempotency_key' });
  if (!rawSession) return send(res, 401, { error: 'paid_entitlement_required' });

  const topKEnabled = enabled('NEARTIME_TOP_K_V2_ENABLED');
  if (!topKEnabled && deviceId !== LIVE_PROBE_DEVICE_ID) {
    return send(res, 503, { error: 'top_k_v2_disabled' });
  }

  let logicalReservationId = null;
  let logicalFinalized = false;
  try {
    const session = await resolveEntitlementSession(rawSession);
    if (!session?.entitlementHash) return send(res, 401, { error: 'invalid_or_expired_entitlement_session' });

    if (!topKEnabled && !canUseDisabledTopKGate({ deviceId, entitlementHash: session.entitlementHash })) {
      return send(res, 503, { error: 'top_k_v2_disabled' });
    }

    const requestHash = canonicalRequestHash(req.body);
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

    const result = await runTopKSearchRuntime({
      apiKey: requiredEnv('GOOGLE_PLACES_SERVER_API_KEY'),
      entitlementHash: session.entitlementHash,
      deviceId,
      searchKey: idempotencyKey,
      origin: req.body.origin,
      query: req.body.query,
      supabaseRpc,
      fetchImpl: global.fetch,
      k: PRODUCT_TOP_K,
    });

    if (result.status !== COMPLETE_TOP_K) {
      const released = await finishLogical(logicalReservationId, 'released', false, null, result.reason || 'top_k_degraded');
      logicalFinalized = Boolean(released?.finalized);
      return send(res, 200, {
        places: [],
        resultStatus: 'DEGRADED',
        rankingMode: result.rankingMode,
        reason: result.reason || 'top_k_degraded',
        providerCalls: result.providerCalls,
        budgetPlan: result.budgetPlan,
        accessMode: 'paid',
      });
    }

    const payload = {
      places: result.places,
      provider: 'google-places-top-k-v2',
      resultStatus: COMPLETE_TOP_K,
      rankingMode: result.rankingMode,
      proof: result.proof?.proof ?? result.proof,
      providerCalls: result.providerCalls,
      budgetPlan: result.budgetPlan,
      accessMode: 'paid',
    };

    const logicalResult = await finishLogical(logicalReservationId, 'succeeded', result.places.length > 0, payload, null);
    if (!logicalResult?.finalized) throw new Error('logical_search_finalize_failed');
    logicalFinalized = true;

    return send(res, 200, {
      ...payload,
      remainingSearches: logicalResult.remaining_searches ?? null,
      remainingAttempts: logicalResult.remaining_attempts ?? null,
    });
  } catch (error) {
    const reason = error?.code || error?.message || 'top_k_search_failed';
    if (logicalReservationId && !logicalFinalized) {
      try {
        await finishLogical(logicalReservationId, 'released', false, null, reason);
      } catch {
        // Logical reservation remains fail-closed until expiry if release fails.
      }
    }
    if (['provider_budget_exhausted', 'external_calls_disabled', 'kill_switch_active', 'wallet_not_found', 'entitlement_inactive', 'sku_price_not_found'].includes(reason)) {
      return send(res, blockedStatus(reason), { error: reason });
    }
    console.error('NearTime Top-K search failed', reason);
    return send(res, 502, { error: 'top_k_search_failed', reason });
  }
};

module.exports.canUseDisabledTopKGate = canUseDisabledTopKGate;
module.exports.LIVE_PROBE_DEVICE_ID = LIVE_PROBE_DEVICE_ID;
module.exports.LIVE_PROBE_ENTITLEMENT_HASH = LIVE_PROBE_ENTITLEMENT_HASH;
module.exports.PRODUCT_TOP_K = PRODUCT_TOP_K;
