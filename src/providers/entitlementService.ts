import { getAnonymousInstallId } from '../device/anonymousInstallId';
import { setEntitlementSessionToken } from '../device/entitlementSession';

const SEARCH_ENDPOINT =
  process.env.EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT?.trim() ||
  'https://neartime.vercel.app/api/search';

const VERIFY_ENDPOINT = SEARCH_ENDPOINT.replace(/\/api\/search\/?$/, '/api/entitlement/verify');

type EntitlementResponse = {
  sessionToken: string;
  status: 'active' | 'grace';
  balance: number;
  productId: string;
  billingPeriodEnd: string;
};

type IosProof = {
  platform: 'ios';
  originalTransactionId: string;
  environment: 'Production' | 'Sandbox';
};

type AndroidProof = {
  platform: 'android';
  purchaseToken: string;
};

export type EntitlementProof = IosProof | AndroidProof;

export async function verifyAndStoreEntitlement(proof: EntitlementProof): Promise<EntitlementResponse> {
  const deviceId = await getAnonymousInstallId();
  const response = await fetch(VERIFY_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-neartime-device-id': deviceId,
    },
    body: JSON.stringify(proof),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Subscription verification failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
  }

  const payload = (await response.json()) as Partial<EntitlementResponse>;
  if (!payload.sessionToken || !payload.status || typeof payload.balance !== 'number') {
    throw new Error('Subscription verification returned an invalid response.');
  }

  await setEntitlementSessionToken(payload.sessionToken);
  return payload as EntitlementResponse;
}
