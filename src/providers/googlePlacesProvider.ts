import type { SearchProvider } from './types';

/**
 * Real Google Places integration boundary.
 *
 * This provider is intentionally non-operational. executeSearch() will hit the
 * global cost policy before this function can ever be called while external
 * APIs remain locked. The explicit throw is a second fail-closed guard.
 */
export const googlePlacesSearchProvider: SearchProvider = {
  id: 'google-places-new',
  kind: 'external',
  estimateCostUnits: () => 1,
  async search() {
    throw new Error('Google Places provider is locked. Enable only after cost policy and live pricing are explicitly approved.');
  },
};
