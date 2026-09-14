const {
  syncVerifiedEntitlement,
  issueEntitlementSession,
} = require('../lib/entitlements');
const {
  recordVerifiedPurchaseAnalyticsBestEffort,
} = require('../lib/purchaseAnalytics');
const {
  tripPassDurationDays,
  verifyAppleTripPass,
  verifyGoogleTripPass,
} = require('../lib/tripPass');

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
  const productId = String(req.body?.productId ?? '');
  const durationDays = tripPassDurationDays(productId);
  if (!durationDays) return send(res, 400, { error: 'invalid_trip_pass_product' });

  try {
    let verified;
    if (platform === 'ios') {
      verified = await verifyAppleTripPass(
        req.body?.transactionId,
        req.body?.environment,
        productId,
      );
    } else if (platform === 'android') {
      verified = await verifyGoogleTripPass(productId, req.body?.purchaseToken);
    } else {
      return send(res, 400, { error: 'invalid_platform' });
    }

    const wallet = await syncVerifiedEntitlement(verified);
    if (verified.status !== 'active') {
      return send(res, 403, {
        error: 'trip_pass_inactive',
        status: verified.status,
        productId: verified.productId,
      });
    }

    // Record only after the store receipt has been verified and the wallet has
    // been synchronized. Telemetry failure cannot revoke valid paid access.
    await recordVerifiedPurchaseAnalyticsBestEffort(deviceId, verified);

    const sessionToken = await issueEntitlementSession(wallet.entitlementHash, deviceId);
    return send(res, 200, {
      sessionToken,
      status: verified.status,
      balance: wallet.balance,
      productId: verified.productId,
      activatedAt: verified.billingPeriodStart,
      expiresAt: verified.billingPeriodEnd,
      durationDays,
    });
  } catch (error) {
    console.error('NearTime Trip Pass verification failed', error instanceof Error ? error.message : error);
    return send(res, 502, { error: 'trip_pass_verification_failed' });
  }
};
