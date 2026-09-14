const {
  verifyAppleNotification,
  syncVerifiedEntitlement,
} = require('../lib/entitlements');

function send(res, status, payload) {
  res.status(status).json(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const signedPayload = req.body?.signedPayload;
  const environment = req.query?.environment === 'sandbox' ? 'Sandbox' : 'Production';
  if (typeof signedPayload !== 'string' || signedPayload.length < 50) {
    return send(res, 400, { error: 'invalid_signed_payload' });
  }

  try {
    const verified = await verifyAppleNotification(signedPayload, environment);
    await syncVerifiedEntitlement(verified);
    return send(res, 200, { ok: true });
  } catch (error) {
    console.error('Apple subscription notification rejected', error instanceof Error ? error.message : error);
    return send(res, 400, { error: 'notification_rejected' });
  }
};
