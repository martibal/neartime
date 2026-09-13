import type { Place } from '../domain/types';
import type { SearchProvider } from './types';

const SEARCH_ENDPOINT = process.env.EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT?.trim();

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

/**
 * Live Places boundary.
 *
 * The mobile app never receives a Google Places server key and never calls
 * Google Places directly. It calls the NearTime backend only after executeSearch()
 * has approved the request locally. The backend must independently perform the
 * authoritative atomic reservation before it is allowed to call Google.
 *
 * EXTERNAL_API_POLICY remains fail-closed by default, so this provider cannot
 * make a network request until the live rollout is deliberately enabled.
 */
export const googlePlacesSearchProvider: SearchProvider = {
  id: 'google-places-via-neartime-backend',
  kind: 'external',
  estimateCostUnits: () => 1,
  async search(query, sortKey, context) {
    if (!SEARCH_ENDPOINT) {
      throw new Error('Live Places search blocked: EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT is not configured.');
    }

    if (!context?.origin) {
      throw new Error('Live Places search blocked: current origin is required.');
    }

    const response = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-neartime-device-id': context.deviceId ?? 'prototype-device',
      },
      body: JSON.stringify({
        query,
        sortKey,
        origin: context.origin,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Live Places search failed (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`);
    }

    const payload = (await response.json()) as Partial<LiveSearchResponse>;
    if (!isPlaceArray(payload.places)) {
      throw new Error('Live Places search failed: backend returned an invalid payload.');
    }

    return payload.places;
  },
};
