import type { CostPolicy } from './types';

// Development default: all billable external calls are hard-disabled.
// Cost units are deliberately provider-agnostic until live provider pricing is frozen.
export const EXTERNAL_API_POLICY: CostPolicy = {
  externalCallsEnabled: false,
  emergencyKillSwitch: true,
  maxEstimatedCostUnitsPerCall: 0,
  globalDailyCostUnits: 0,
  globalMonthlyCostUnits: 0,
  perDeviceDailyCostUnits: 0,
  maxRequestsPerMinutePerDevice: 0,
};

export const EXTERNAL_APIS_LOCKED =
  !EXTERNAL_API_POLICY.externalCallsEnabled || EXTERNAL_API_POLICY.emergencyKillSwitch;
