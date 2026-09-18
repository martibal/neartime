const crypto = require('node:crypto');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function normalizePem(value) {
  return value.replace(/\\n/g, '\n');
}

function hmacHex(namespace, value) {
  return crypto
    .createHmac('sha256', requiredEnv('ENTITLEMENT_HMAC_SECRET'))
    .update(`${namespace}:${value}`)
    .digest('hex');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createOpaqueSessionToken() {
  return `nts_${crypto.randomBytes(32).toString('base64url')}`;
}

async function supabaseRpc(functionName, body) {
  const url = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Supabase RPC ${functionName} failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function firstRow(payload) {
  return Array.isArray(payload) ? payload[0] : payload;
}

async function resolveEntitlementSession(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 256) return null;
  const payload = await supabaseRpc('resolve_entitlement_session', {
    p_token_hash: sha256Hex(rawToken),
  });
  const row = firstRow(payload);
  if (!row?.entitlement_hash) return null;
  return {
    entitlementHash: row.entitlement_hash,
    status: row.status,
    balance: Number(row.balance ?? 0),
  };
}

async function issueEntitlementSession(entitlementHash, deviceId) {
  const token = createOpaqueSessionToken();
  const payload = await supabaseRpc('create_entitlement_session', {
    p_entitlement_hash: entitlementHash,
    p_token_hash: sha256Hex(token),
    p_device_id: deviceId,
    p_ttl_minutes: 10080,
  });
  const value = firstRow(payload);
  const created = value === true || value?.create_entitlement_session === true;
  if (!created) throw new Error('Entitlement session could not be created.');
  return token;
}

function appleLibrary() {
  // Lazy require keeps ordinary search/runtime startup independent of App Store credentials.
  // Apple publishes and maintains this package specifically for Server API/JWS verification.
  return require('@apple/app-store-server-library');
}

function appleEnvironment(value) {
  const { Environment } = appleLibrary();
  if (value === 'Sandbox') return Environment.SANDBOX;
  if (value === 'Production') return Environment.PRODUCTION;
  throw new Error('invalid_apple_environment');
}

function appleComponents(environmentName) {
  const {
    AppStoreServerAPIClient,
    SignedDataVerifier,
  } = appleLibrary();
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

function appleStatusToWallet(status, transaction) {
  if (transaction?.revocationDate) return 'refunded';
  if (Number(status) === 1) return 'active';
  if (Number(status) === 4) return 'grace';
  return 'expired';
}

async function verifyAppleSubscription(originalTransactionId, environmentName) {
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(String(originalTransactionId ?? ''))) {
    throw new Error('invalid_original_transaction_id');
  }

  const { client, verifier } = appleComponents(environmentName);
  const statusResponse = await client.getAllSubscriptionStatuses(String(originalTransactionId));
  const groups = Array.isArray(statusResponse?.data) ? statusResponse.data : [];
  const candidates = [];

  for (const group of groups) {
    for (const last of Array.isArray(group?.lastTransactions) ? group.lastTransactions : []) {
      if (!last?.signedTransactionInfo) continue;
      const transaction = await verifier.verifyAndDecodeTransaction(last.signedTransactionInfo);
      const expiry = Number(transaction.expiresDate ?? 0);
      candidates.push({ status: last.status, transaction, expiry });
    }
  }

  if (candidates.length === 0) throw new Error('apple_subscription_not_found');
  candidates.sort((a, b) => b.expiry - a.expiry);
  const latest = candidates[0];
  const transaction = latest.transaction;
  const canonicalId = String(transaction.originalTransactionId ?? originalTransactionId);
  const startMs = Number(transaction.purchaseDate ?? transaction.originalPurchaseDate ?? 0);
  const endMs = Number(transaction.expiresDate ?? 0);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('invalid_apple_subscription_period');
  }

  return {
    platform: 'ios',
    externalIdHash: hmacHex('ios-external', canonicalId),
    linkedExternalIdHash: null,
    proposedEntitlementHash: hmacHex('ios-wallet', canonicalId),
    productId: String(transaction.productId ?? ''),
    billingPeriodStart: new Date(startMs).toISOString(),
    billingPeriodEnd: new Date(endMs).toISOString(),
    status: appleStatusToWallet(latest.status, transaction),
  };
}

async function verifyAppleNotification(signedPayload, environmentName) {
  const { verifier } = appleComponents(environmentName);
  const decoded = await verifier.verifyAndDecodeNotification(signedPayload);
  const signedTransaction = decoded?.data?.signedTransactionInfo;
  if (!signedTransaction) throw new Error('apple_notification_missing_transaction');
  const transaction = await verifier.verifyAndDecodeTransaction(signedTransaction);
  const originalTransactionId = String(transaction.originalTransactionId ?? '');
  if (!originalTransactionId) throw new Error('apple_notification_missing_original_transaction');
  return verifyAppleSubscription(originalTransactionId, environmentName);
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

function googleWalletStatus(subscription, endMs) {
  const state = String(subscription?.subscriptionState ?? '');
  if (state === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') return 'grace';
  if (state === 'SUBSCRIPTION_STATE_ACTIVE') return 'active';
  if (state === 'SUBSCRIPTION_STATE_CANCELED' && endMs > Date.now()) return 'active';
  return 'expired';
}

async function verifyGoogleSubscription(purchaseToken) {
  if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
    throw new Error('invalid_purchase_token');
  }
  const accessToken = await googleAccessToken();
  const packageName = requiredEnv('GOOGLE_PLAY_PACKAGE_NAME');
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`google_subscription_verify_failed_${response.status}`);
  const subscription = await response.json();
  const lineItems = Array.isArray(subscription?.lineItems) ? subscription.lineItems : [];
  if (lineItems.length === 0) throw new Error('google_subscription_has_no_line_items');

  const latest = [...lineItems].sort((a, b) => Date.parse(b.expiryTime ?? 0) - Date.parse(a.expiryTime ?? 0))[0];
  const startMs = Date.parse(subscription.startTime ?? '');
  const endMs = Date.parse(latest.expiryTime ?? '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('invalid_google_subscription_period');
  }

  const linked = typeof subscription.linkedPurchaseToken === 'string' ? subscription.linkedPurchaseToken : null;
  return {
    platform: 'android',
    externalIdHash: hmacHex('android-external', purchaseToken),
    linkedExternalIdHash: linked ? hmacHex('android-external', linked) : null,
    proposedEntitlementHash: hmacHex('android-wallet', purchaseToken),
    productId: String(latest.productId ?? ''),
    billingPeriodStart: new Date(startMs).toISOString(),
    billingPeriodEnd: new Date(endMs).toISOString(),
    status: googleWalletStatus(subscription, endMs),
  };
}

async function verifyGoogleOneTimeProduct(productId, purchaseToken) {
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(String(productId ?? ''))) {
    throw new Error('invalid_product_id');
  }
  if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
    throw new Error('invalid_purchase_token');
  }

  const accessToken = await googleAccessToken();
  const packageName = requiredEnv('GOOGLE_PLAY_PACKAGE_NAME');
  const url = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(packageName) + '/purchases/products/' +
    encodeURIComponent(productId) + '/tokens/' + encodeURIComponent(purchaseToken);
  const response = await fetch(url, { headers: { authorization: 'Bearer ' + accessToken } });
  if (!response.ok) throw new Error('google_one_time_product_verify_failed_' + response.status);

  const purchase = await response.json();
  if (Number(purchase.purchaseState) !== 0) {
    throw new Error('google_one_time_product_not_purchased');
  }

  return {
    platform: 'android',
    productId,
    purchaseToken,
    purchaseTimeMillis: Number(purchase.purchaseTimeMillis ?? 0),
    acknowledged: Number(purchase.acknowledgementState ?? 0) === 1,
  };
}
async function syncVerifiedEntitlement(verified) {
  const payload = await supabaseRpc('upsert_verified_entitlement', {
    p_platform: verified.platform,
    p_external_id_hash: verified.externalIdHash,
    p_linked_external_id_hash: verified.linkedExternalIdHash,
    p_proposed_entitlement_hash: verified.proposedEntitlementHash,
    p_product_id: verified.productId,
    p_billing_period_start: verified.billingPeriodStart,
    p_billing_period_end: verified.billingPeriodEnd,
    p_status: verified.status,
  });
  const row = firstRow(payload);
  if (!row?.entitlement_hash) throw new Error('wallet_sync_failed');
  return { entitlementHash: row.entitlement_hash, balance: Number(row.balance ?? 0) };
}

async function verifyGooglePubSubAuthorization(authorizationHeader) {
  const bearer = typeof authorizationHeader === 'string' && authorizationHeader.startsWith('Bearer ')
    ? authorizationHeader.slice(7)
    : '';
  if (!bearer) throw new Error('missing_google_pubsub_bearer');
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(bearer)}`);
  if (!response.ok) throw new Error('invalid_google_pubsub_token');
  const claims = await response.json();
  if (claims.aud !== requiredEnv('GOOGLE_PLAY_PUBSUB_AUDIENCE')) throw new Error('invalid_google_pubsub_audience');
  const expectedEmail = process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL?.trim();
  if (expectedEmail && claims.email !== expectedEmail) throw new Error('invalid_google_pubsub_sender');
  return claims;
}

module.exports = {
  requiredEnv,
  hmacHex,
  sha256Hex,
  supabaseRpc,
  resolveEntitlementSession,
  issueEntitlementSession,
  verifyAppleSubscription,
  verifyAppleNotification,
  verifyGoogleSubscription,
  verifyGoogleOneTimeProduct,
  syncVerifiedEntitlement,
  verifyGooglePubSubAuthorization,
  appleStatusToWallet,
  googleWalletStatus,
};
