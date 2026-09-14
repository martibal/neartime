const {
  verifyAppleSubscription,
  verifyGoogleSubscription,
  syncVerifiedEntitlement,
  issueEntitlementSession,
} = require('../lib/entitlements');

function send(res, status, payload) {
  res.status(status).json(payload);
}

function sanitizeDeviceId(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return candidate && candidate.length <= 128 ? candidate : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const deviceId = sanitizeDeviceId(req.headers['x-neartime-device-id']);
  if (!deviceId) return send(res, 400, { error: 'invalid_device_id' });

  const platform = req.body?.platform;
  try {
    let verified;
    if (platform === 'ios') {
      verified = await verifyAppleSubscription(
        req.body?.originalTransactionId,
        req.body?.environment,
      );
    } else if (platform === 'android') {
      verified = await verifyGoogleSubscription(req.body?.purchaseToken);
    } else {
      return send(res, 400, { error: 'invalid_platform' });
    }

    const wallet = await syncVerifiedEntitlement(verified);
    if (!['active', 'grace'].includes(verified.status)) {
      return send(res, 403, {
        error: 'entitlement_inactive',
        status: verified.status,
      });
    }

    const sessionToken = await issueEntitlementSession(wallet.entitlementHash, deviceId);
    return send(res, 200, {
      sessionToken,
      status: verified.status,
      balance: wallet.balance,
      productId: verified.productId,
      billingPeriodEnd: verified.billingPeriodEnd,
    });
  } catch (error) {
    console.error('NearTime entitlement verification failed', error instanceof Error ? error.message : error);
    return send(res, 502, { error: 'entitlement_verification_failed' });
  }
};
