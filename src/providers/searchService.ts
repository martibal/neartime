import {
  EXTERNAL_API_POLICY,
  appendReservation,
  emptyUsageSnapshot,
  reserveExternalCall,
  runReservedExternalCall,
  updateReservationStatus,
} from '../cost';
import type { ExternalApiService, UsageSnapshot } from '../cost';
import type { Coordinate, SearchQuery, SortKey } from '../domain/types';
import type { SearchProvider, SearchProviderContext, SearchProviderResult } from './types';

let usageSnapshot: UsageSnapshot = emptyUsageSnapshot();

export function getSearchUsageSnapshot(): UsageSnapshot {
  return usageSnapshot;
}

export async function executeSearch(
  provider: SearchProvider,
  query: SearchQuery,
  sortKey: SortKey,
  deviceId = 'prototype-device',
  origin?: Coordinate,
): Promise<SearchProviderResult> {
  const estimatedCostUnits = provider.estimateCostUnits(query);
  const context: SearchProviderContext = { deviceId, origin };

  if (provider.kind === 'mock') {
    const places = await provider.search(query, sortKey, context);
    return {
      places,
      provider: provider.id,
      costUnits: 0,
      usedExternalCall: false,
    };
  }

  const service: ExternalApiService = 'places-search';
  const decision = reserveExternalCall(
    EXTERNAL_API_POLICY,
    usageSnapshot,
    { deviceId, now: new Date() },
    { service, estimatedCostUnits },
  );

  if (!decision.allowed) {
    return Promise.reject(new Error(`External search blocked: ${decision.reason}`));
  }

  usageSnapshot = appendReservation(usageSnapshot, decision.reservation);

  try {
    const places = await runReservedExternalCall(decision, () => provider.search(query, sortKey, context));
    usageSnapshot = updateReservationStatus(usageSnapshot, decision.reservation.id, 'committed');
    return {
      places,
      provider: provider.id,
      costUnits: estimatedCostUnits,
      usedExternalCall: true,
    };
  } catch (error) {
    usageSnapshot = updateReservationStatus(usageSnapshot, decision.reservation.id, 'released');
    throw error;
  }
}
