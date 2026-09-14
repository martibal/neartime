import * as Location from 'expo-location';

import { googlePlacesSearchProvider } from './googlePlacesProvider';
import type { SearchProvider } from './types';

/**
 * Temporary compatibility export for the current prototype UI.
 * The UI still imports mockSearchProvider, but searches now resolve the current
 * device location and delegate to the real NearTime backend provider.
 * This keeps the existing screen intact while live-data labels are cleaned up
 * in the next UI pass.
 */
export const mockSearchProvider: SearchProvider = {
  id: 'google-places-live',
  kind: 'external',
  estimateCostUnits: () => 1,
  async search(query, sortKey, context) {
    let origin = context.origin;

    if (!origin) {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      origin = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      };
    }

    return googlePlacesSearchProvider.search(query, sortKey, {
      ...context,
      origin,
    });
  },
};
