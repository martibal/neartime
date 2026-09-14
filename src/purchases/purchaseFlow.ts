import { getAnonymousInstallId } from '../device/anonymousInstallId';
import { setEntitlementSessionToken } from '../device/entitlementSession';
import type { LaunchProduct } from './catalog';
import { beginStorePurchase, type VerifiedPurchaseReceipt } from './purchaseBoundary';

const ENTITLEMENT_ENDPOINT =
  process.env.EXPO_PUBLIC_NEARTIME_ENTITLEMENT_ENDPOINT?.trim() ||
  'https://neartime.vercel.app/api/entitlement/verify';

export class PurchaseActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseActivationError';
  }
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

  if (!response.ok) {
    throw new PurchaseActivationError(`ENTITLEMENT_VERIFICATION_FAILED_${response.status}`);
  }

  const payload = await response.json() as { sessionToken?: unknown };
  if (typeof payload.sessionToken !== 'string' || payload.sessionToken.length < 20) {
    throw new PurchaseActivationError('INVALID_ENTITLEMENT_SESSION');
  }

  await setEntitlementSessionToken(payload.sessionToken);
}

/**
 * Store purchase orchestration.
 * Native checkout comes first. Access is only activated after NearTime's server
 * verifies the store receipt and issues an opaque entitlement session.
 */
export async function purchaseAndActivate(product: LaunchProduct): Promise<void> {
  const receipt = await beginStorePurchase(product);

  if (receipt.kind === 'trip_pass') {
    // Trip Passes are non-renewing purchases and need their own server receipt
    // verification/activation endpoint. Never route them through subscription
    // verification or synthesize access client-side.
    throw new PurchaseActivationError('TRIP_PASS_SERVER_VERIFICATION_NOT_CONFIGURED');
  }

  await activateSubscription(receipt);
}
