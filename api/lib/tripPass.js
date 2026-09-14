const crypto = require('node:crypto');

const { requiredEnv, hmacHex } = require('./entitlements');

const TRIP_PASS_DAYS = Object.freeze({
  neartime_trip_3d: 3,
  neartime_trip_7d: 7,
});

function normalizePem(value) {
  return value.replace(/\\n/g, '\n');
}

function tripPassDurationDays(productId) {
  return TRIP_PASS_DAYS[productId] ?? null;
}

function tripPassWindow(productId, purchaseMs) {
  const days = tripPassDurationDays(productId);
  if (!days) throw new Error('invalid_trip_pass_product');
  if (!Number.isFinite(purchaseMs) || purchaseMs <= 0) throw new Error('invalid_trip_pass_purchase_time');
  const endMs = purchaseMs + days * 24 * 60 * 60 * 1000;
  return {
    startMs: purchaseMs,
    endMs,
    billingPeriodStart: new Date(purchaseMs).toISOString(),
    billingPeriodEnd: new Date(endMs).toISOString(),
  };
}

function tripPassStatus({ purchaseMs, productId, revoked = false, purchased = true, nowMs = Date.now() }) {
  if (revoked) return 'refunded';
  if (!purchased) return 'expired';
  const { endMs } = tripPassWindow(productId, purchaseMs);
  return endMs > nowMs ? 'active' : 'expired';
}

function appleLibrary() {
  return require('@apple/app-store-server-library');
}

function appleEnvironment(value) {
  const { Environment } = appleLibrary();
  if (value === 'Sandbox') return Environment.SANDBOX;
  if (value === 'Production') return Environment.PRODUCTION;
  throw new Error('invalid_apple_environment');
}

function appleComponents(environmentName) {
  const { AppStoreServerAPIClient, SignedDataVerifier } = appleLibrary();
  const environment = appleEnvironment(environmentName);
  const bundleId = requiredEnv('APPLE_BUNDLE_ID');
  const appAppleId = environmentName === 'Production' ? Number(requiredEnv('APPLE_APP_ID')) : undefined;
  if (environmentName === 'Production' && !Number.isInteger(appAppleId)) throw new Error('invalid_apple_app_id');

  const client = new AppStoreServerAPIClient(
    normalizePem(requiredEnv('APPLE_IAP_PRIVATE_KEY_P8')),
    requiredEnv('APPLE_IAP_KEY_ID'),
    requiredEnv('APPLE_IAP_ISSUER_ID'),
    bundleId,
    environment,
  );

  const roots = requiredEnv('APPLE_ROOT_CA_CERTS_BASE64')
    .split(',')
    .map((value) => Buffer.from(value.trim(), 'base64'))
    .filter((value) => value.length > 0);
  if (roots.length === 0) throw new Error('missing_apple_root_certificates');

  const verifier = new SignedDataVerifier(roots, true, environment, bundleId, appAppleId);
  return { client, verifier };
}

async function verifyAppleTripPass(transactionId, environmentName, expectedProductId) {
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(String(transactionId ?? ''))) {
    throw new Error('invalid_apple_transaction_id');
  }
  if (!tripPassDurationDays(expectedProductId)) throw new Error('invalid_trip_pass_product');

  const { client, verifier } = appleComponents(environmentName);
  const response = await client.getTransactionInfo(String(transactionId));
  if (!response?.signedTransactionInfo) throw new Error('apple_trip_pass_transaction_not_found');
  const transaction = await verifier.verifyAndDecodeTransaction(response.signedTransactionInfo);

  const verifiedTransactionId = String(transaction.transactionId ?? '');
  const productId = String(transaction.productId ?? '');
  if (verifiedTransactionId !== String(transactionId)) throw new Error('apple_trip_pass_transaction_mismatch');
  if (productId !== expectedProductId) throw new Error('apple_trip_pass_product_mismatch');

  const purchaseMs = Number(transaction.purchaseDate ?? transaction.originalPurchaseDate ?? 0);
  const window = tripPassWindow(productId, purchaseMs);
  const status = tripPassStatus({
    purchaseMs,
    productId,
    revoked: Boolean(transaction.revocationDate),
  });

  return {
    platform: 'ios',
    externalIdHash: hmacHex('ios-trip-external', verifiedTransactionId),
    linkedExternalIdHash: null,
    proposedEntitlementHash: hmacHex('ios-trip-wallet', verifiedTransactionId),
    productId,
    billingPeriodStart: window.billingPeriodStart,
    billingPeriodEnd: window.billingPeriodEnd,
    status,
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function googleAccessToken() {
  const serviceAccount = JSON.parse(requiredEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON'));
  if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('invalid_google_service_account');
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64urlJson({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), normalizePem(serviceAccount.private_key)).toString('base64url');
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) throw new Error(`google_oauth_failed_${response.status}`);
  const body = await response.json();
  if (!body?.access_token) throw new Error('google_oauth_missing_access_token');
  return body.access_token;
}

async function verifyGoogleTripPass(productId, purchaseToken) {
  if (!tripPassDurationDays(productId)) throw new Error('invalid_trip_pass_product');
  if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
    throw new Error('invalid_purchase_token');
  }

  const accessToken = await googleAccessToken();
  const packageName = requiredEnv('GOOGLE_PLAY_PACKAGE_NAME');
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`google_trip_pass_verify_failed_${response.status}`);
  const purchase = await response.json();

  if (purchase.productId && String(purchase.productId) !== productId) {
    throw new Error('google_trip_pass_product_mismatch');
  }

  const purchaseMs = Number(purchase.purchaseTimeMillis ?? 0);
  const window = tripPassWindow(productId, purchaseMs);
  const purchaseState = Number(purchase.purchaseState);
  const status = tripPassStatus({
    purchaseMs,
    productId,
    purchased: purchaseState === 0,
    revoked: purchaseState === 1,
  });

  return {
    platform: 'android',
    externalIdHash: hmacHex('android-trip-external', purchaseToken),
    linkedExternalIdHash: null,
    proposedEntitlementHash: hmacHex('android-trip-wallet', purchaseToken),
    productId,
    billingPeriodStart: window.billingPeriodStart,
    billingPeriodEnd: window.billingPeriodEnd,
    status,
  };
}

module.exports = {
  TRIP_PASS_DAYS,
  tripPassDurationDays,
  tripPassWindow,
  tripPassStatus,
  verifyAppleTripPass,
  verifyGoogleTripPass,
};
