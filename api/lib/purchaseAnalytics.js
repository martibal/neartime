const { sha256Hex, supabaseRpc } = require('./entitlements');

function installHashForDevice(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.trim().length > 128) {
    throw new Error('invalid_device_id');
  }
  return sha256Hex(`install:${deviceId.trim()}`);
}

function purchaseAnalyticsPayload(deviceId, verified) {
  if (!verified || typeof verified !== 'object') throw new Error('invalid_verified_purchase');
  const purchaseKey = String(verified.externalIdHash ?? '');
  const sku = String(verified.productId ?? '');
  const activatedAt = String(verified.billingPeriodStart ?? '');
  const expiresAt = String(verified.billingPeriodEnd ?? '');

  if (purchaseKey.length !== 64) throw new Error('invalid_purchase_key');
  if (!['neartime_trip_3d', 'neartime_monthly', 'neartime_trip_7d'].includes(sku)) {
    throw new Error('invalid_launch_sku');
  }
  if (!activatedAt || !expiresAt) throw new Error('invalid_purchase_window');

  return {
    p_install_hash: installHashForDevice(deviceId),
    p_purchase_key: purchaseKey,
    p_sku: sku,
    p_activated_at: activatedAt,
    p_expires_at: expiresAt,
  };
}

async function recordVerifiedPurchaseAnalytics(deviceId, verified) {
  return supabaseRpc('record_verified_purchase_funnel', purchaseAnalyticsPayload(deviceId, verified));
}

async function recordVerifiedPurchaseAnalyticsBestEffort(deviceId, verified) {
  try {
    await recordVerifiedPurchaseAnalytics(deviceId, verified);
    return true;
  } catch (error) {
    console.error(
      'NearTime verified purchase analytics failed',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

module.exports = {
  installHashForDevice,
  purchaseAnalyticsPayload,
  recordVerifiedPurchaseAnalytics,
  recordVerifiedPurchaseAnalyticsBestEffort,
};
