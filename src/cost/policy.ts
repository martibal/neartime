import type { CostPolicy } from './types';

// Prototype live-search policy. This is only a secondary client-side guard.
// The NearTime backend remains authoritative and performs the atomic reservation
// before any billable Google Places request is allowed.
export const EXTERNAL_API_POLICY: CostPolicy = {
  externalCallsEnabled: true,
  emergencyKillSwitch: false,
  maxEstimatedCostUnitsPerCall: 1,
  globalDailyCostUnits: 5,
  globalMonthlyCostUnits: 5,
  perDeviceDailyCostUnits: 5,
  maxRequestsPerMinutePerDevice: 2,
};

export const EXTERNAL_APIS_LOCKED =
  !EXTERNAL_API_POLICY.externalCallsEnabled || EXTERNAL_API_POLICY.emergencyKillSwitch;
