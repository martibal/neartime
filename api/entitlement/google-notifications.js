const {
  verifyGooglePubSubAuthorization,
  verifyGoogleSubscription,
  syncVerifiedEntitlement,
  requiredEnv,
} = require('../lib/entitlements');

function send(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  try {
    await verifyGooglePubSubAuthorization(req.headers.authorization);
    const encoded = req.body?.message?.data;
    if (typeof encoded !== 'string') return send(res, 400, { error: 'invalid_pubsub_message' });

    const notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (notification.packageName !== requiredEnv('GOOGLE_PLAY_PACKAGE_NAME')) {
      return send(res, 400, { error: 'invalid_package_name' });
    }

    const purchaseToken = notification.subscriptionNotification?.purchaseToken;
    if (typeof purchaseToken !== 'string') {
      // Ignore unrelated product/test messages. Pub/Sub retries are not useful for them here.
      return send(res, 200, { ok: true, ignored: true });
    }

    const verified = await verifyGoogleSubscription(purchaseToken);
    await syncVerifiedEntitlement(verified);
    return send(res, 200, { ok: true });
  } catch (error) {
    console.error('Google Play subscription notification rejected', error instanceof Error ? error.message : error);
    return send(res, 400, { error: 'notification_rejected' });
  }
};
