import { getAnonymousInstallId } from '../device/anonymousInstallId';
import { setEntitlementSessionToken } from '../device/entitlementSession';
import type { LaunchProduct } from './catalog';
import { beginStorePurchase, type VerifiedPurchaseReceipt } from './purchaseBoundary';
import { finishVerifiedNativePurchase } from './nativeStoreAdapter';

const ENTITLEMENT_ENDPOINT =
  process.env.EXPO_PUBLIC_NEARTIME_ENTITLEMENT_ENDPOINT?.trim() ||
  'https://neartime.vercel.app/api/entitlement/verify';

const TRIP_PASS_ENDPOINT =
  process.env.EXPO_PUBLIC_NEARTIME_TRIP_PASS_ENDPOINT?.trim() ||
  'https://neartime.vercel.app/api/entitlement/trip-pass';

export class PurchaseActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseActivationError';
  }
}

async function persistVerifiedSession(response: Response, errorPrefix: string): Promise<void> {
  if (!response.ok) {
    throw new PurchaseActivationError(`${errorPrefix}_${response.status}`);
  }

  const payload = await response.json() as { sessionToken?: unknown };
  if (typeof payload.sessionToken !== 'string' || payload.sessionToken.length < 20) {
    throw new PurchaseActivationError('INVALID_ENTITLEMENT_SESSION');
  }

  await setEntitlementSessionToken(payload.sessionToken);
}

async function activateSubscription(receipt: Extract<VerifiedPurchaseReceipt, { kind: 'subscription' }>): Promise<void> {
  const deviceId = await getAnonymousInstallId();
  const body = receipt.platform === 'ios'
    ? {
        platform: 'ios',
        originalTransactionId: receipt.originalTransactionId,
        environment: receipt.environment,
      }
    : {
        platform: 'android',
        purchaseToken: receipt.purchaseToken,
      };

  const response = await fetch(ENTITLEMENT_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-neartime-device-id': deviceId,
    },
    body: JSON.stringify(body),
  });

  await persistVerifiedSession(response, 'ENTITLEMENT_VERIFICATION_FAILED');
}

async function activateTripPass(receipt: Extract<VerifiedPurchaseReceipt, { kind: 'trip_pass' }>): Promise<void> {
  const deviceId = await getAnonymousInstallId();
  const body = receipt.platform === 'ios'
    ? {
        platform: 'ios',
        productId: receipt.productId,
        transactionId: receipt.transactionId,
        environment: receipt.environment,
      }
    : {
        platform: 'android',
        productId: receipt.productId,
        purchaseToken: receipt.purchaseToken,
      };

  const response = await fetch(TRIP_PASS_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-neartime-device-id': deviceId,
    },
    body: JSON.stringify(body),
  });

  await persistVerifiedSession(response, 'TRIP_PASS_VERIFICATION_FAILED');
}

/**
 * Store purchase orchestration.
 * Native checkout comes first. Access is only activated after NearTime's server
 * verifies the store receipt and issues an opaque entitlement session. The
 * native transaction is finished only after that verification succeeds.
 */
export async function purchaseAndActivate(product: LaunchProduct): Promise<void> {
  const receipt = await beginStorePurchase(product);

  if (receipt.kind === 'trip_pass') {
    await activateTripPass(receipt);
  } else {
    await activateSubscription(receipt);
  }

  await finishVerifiedNativePurchase(receipt);
}
