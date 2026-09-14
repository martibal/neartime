import { getAnonymousInstallId } from '../device/anonymousInstallId';
import { getEntitlementSessionToken } from '../device/entitlementSession';
import type { Place } from '../domain/types';
import type { SearchProvider } from './types';

const SEARCH_ENDPOINT =
  process.env.EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT?.trim() ||
  'https://neartime.vercel.app/api/search';

const RETRY_DELAYS_MS = [0, 700, 1400];

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
 * Google Places directly. A verified entitlement session and a logical-search
 * idempotency key are required before the backend can reserve provider spend.
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
    if (!entitlementSession) {
      throw new Error('Subscription verification is required before live search.');
    }

    const idempotencyKey = createSearchIdempotencyKey();
    let lastDetail = '';
    let lastStatus = 0;

    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt += 1) {
      const retryDelay = RETRY_DELAYS_MS[attempt] ?? 0;
      if (retryDelay > 0) await sleep(retryDelay);

      try {
        const response = await fetch(SEARCH_ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-neartime-device-id': anonymousInstallId,
            'x-neartime-entitlement-session': entitlementSession,
            'x-neartime-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            query,
            sortKey,
            origin: context.origin,
          }),
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
          throw new Error('Monthly NearTime usage is exhausted. Add a usage pack to continue.');
        }
        if (response.status === 401 || response.status === 403) {
          await clearInvalidSession(response.status);
          throw new Error('Subscription verification is required before live search.');
        }

        // 409 means the first copy of the same logical request may still be running.
        // 5xx/network errors are retried with the same idempotency key so the
        // backend can replay the already-committed result rather than spend twice.
        if (response.status !== 409 && response.status < 500) break;
      } catch (error) {
        if (error instanceof Error && (
          error.message.includes('Monthly NearTime usage') ||
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
