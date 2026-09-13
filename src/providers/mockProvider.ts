import { mockPlaces, runQuery } from '../core/neartime';
import type { SearchProvider } from './types';

export const mockSearchProvider: SearchProvider = {
  id: 'mock-local',
  kind: 'mock',
  estimateCostUnits: () => 0,
  async search(query, sortKey) {
    return runQuery(mockPlaces, query, sortKey).sorted;
  },
};
