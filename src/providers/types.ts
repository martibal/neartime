import type { Place, SearchQuery, SortKey } from '../domain/types';

export type SearchProviderKind = 'mock' | 'external';

export type SearchProviderResult = {
  places: Place[];
  provider: string;
  costUnits: number;
  usedExternalCall: boolean;
};

export type SearchProvider = {
  id: string;
  kind: SearchProviderKind;
  estimateCostUnits: (query: SearchQuery) => number;
  search: (query: SearchQuery, sortKey: SortKey) => Promise<Place[]>;
};
