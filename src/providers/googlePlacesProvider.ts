import { getAnonymousInstallId } from '../device/anonymousInstallId';
import { getEntitlementSessionToken } from '../device/entitlementSession';
import type { Place } from '../domain/types';
import type { SearchProvider } from './types';

const SEARCH_ENDPOINT =
  process.env.EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT?.trim() ||
  'https://neartime.vercel.app/api/search';

const RETRY_DELAYS_MS = [0, 700, 1400];

export const PAYWALL_REQUIRED_ERROR = 'NEARTIME_PAYWALL_REQUIRED';

type LiveSearchResponse = {
  places: Place[];
  provider?: string;
};

function isPlaceArray(value: unknown): value is Place[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const place = item as Partial<Place>;
    return typeof place.id === 'string' && typeof place.name === 'string';
  });
}

function randomHex(bytes: number): string {
  let value = '';
  for (let index = 0; index < bytes; index += 1) {
    value += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return value;
}

function createSearchIdempotencyKey(): string {
  return `nts_search_${Date.now().toString(36)}_${randomHex(16)}`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Live Places boundary.
 *
 * The mobile app never receives a Google Places server key and never calls
 * Google Places directly. Before purchase, the request is intentionally sent
 * without an entitlement session and can only pass the backend's bounded free
 * trial gate. After purchase, the opaque entitlement session selects the paid
 * logical-search quota. Both paths remain behind the authoritative provider
 * cost gate before any Google call is permitted.
 */
export const googlePlacesSearchProvider: SearchProvider = {
  id: 'google-places-via-neartime-backend',
  kind: 'external',
  estimateCostUnits: () => 1,
  async search(query, sortKey, context) {
    if (!context?.origin) {
      throw new Error('Live Places search blocked: current origin is required.');
    }

    const [anonymousInstallId, entitlementSession] = await Promise.all([
      getAnonymousInstallId(),
      getEntitlementSessionToken(),
    ]);

    const idempotencyKey = createSearchIdempotencyKey();
    let lastDetail = '';
    let lastStatus = 0;

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      const retryDelay = RETRY_DELAYS_MS[attempt] ?? 0;
      if (retryDelay > 0) await sleep(retryDelay);

      try {
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          'x-neartime-device-id': anonymousInstallId,
          'x-neartime-idempotency-key': idempotencyKey,
        };
        if (entitlementSession) headers['x-neartime-entitlement-session'] = entitlementSession;

        const response = await fetch(SEARCH_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, sortKey, origin: context.origin }),
        });

        lastStatus = response.status;
        if (response.ok) {
          const payload = (await response.json()) as Partial<LiveSearchResponse>;
          if (!isPlaceArray(payload.places)) {
            throw new Error('Live Places search failed: backend returned an invalid payload.');
          }
          return payload.places;
        }

        lastDetail = await response.text().catch(() => '');
        if (response.status === 402) {
          throw new Error(PAYWALL_REQUIRED_ERROR);
        }
        if (response.status === 401 || response.status === 403) {
          if (entitlementSession) {
            await clearInvalidSession(response.status);
            throw new Error('Subscription verification is required before live search.');
          }
          throw new Error(PAYWALL_REQUIRED_ERROR);
        }

        if (response.status !== 409 && response.status < 500) break;
      } catch (error) {
        if (error instanceof Error && (
          error.message === PAYWALL_REQUIRED_ERROR ||
          error.message.includes('Subscription verification') ||
          error.message.includes('invalid payload')
        )) {
          throw error;
        }
        if (attempt === RETRY_DELAYS_MS.length - 1) throw error;
      }
    }

    throw new Error(`Live Places search failed (${lastStatus || 'network'})${lastDetail ? `: ${lastDetail.slice(0, 160)}` : ''}`);
  },
};

async function clearInvalidSession(status: number): Promise<void> {
  if (status !== 401 && status !== 403) return;
  const { clearEntitlementSessionToken } = await import('../device/entitlementSession');
  await clearEntitlementSessionToken();
}
