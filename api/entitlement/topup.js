const {
  hmacHex,
  resolveEntitlementSession,
  supabaseRpc,
  verifyGoogleOneTimeProduct,
} = require('../lib/entitlements');

const PRODUCT_ID = 'neartime_search_pack_20';

function send(res, status, payload) {
  res.status(status).json(payload);
}

function bearerToken(value) {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token.length >= 20 && token.length <= 256 ? token : null;
}

function firstRow(payload) {
  return Array.isArray(payload) ? payload[0] : payload;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const sessionToken = bearerToken(req.headers.authorization);
  if (!sessionToken) return send(res, 401, { error: 'missing_entitlement_session' });

  const session = await resolveEntitlementSession(sessionToken);
  if (!session || !['active', 'grace'].includes(session.status)) {
    return send(res, 403, { error: 'active_subscription_required' });
  }

  if (req.body?.platform !== 'android') return send(res, 400, { error: 'invalid_platform' });
  const productId = String(req.body?.productId ?? '');
  if (productId !== PRODUCT_ID) return send(res, 400, { error: 'invalid_search_pack_product' });

  try {
    const verified = await verifyGoogleOneTimeProduct(productId, req.body?.purchaseToken);
    const credit = firstRow(await supabaseRpc('credit_verified_search_topup', {
      p_entitlement_hash: session.entitlementHash,
      p_platform: 'android',
      p_product_id: productId,
      p_purchase_hash: hmacHex('android-search-topup', verified.purchaseToken),
    }));
    if (!credit) throw new Error('topup_credit_failed');

    return send(res, 200, {
      credited: Boolean(credit.credited),
      searchesGranted: Number(credit.searches_granted ?? 0),
      extraRemaining: Number(credit.extra_remaining ?? 0),
      productId,
    });
  } catch (error) {
    console.error('NearTime search-pack verification failed', error instanceof Error ? error.message : error);
    return send(res, 502, { error: 'search_pack_verification_failed' });
  }
};
