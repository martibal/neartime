export type ExternalApiService = 'places-search' | 'place-details' | 'routes-matrix' | 'geocoding';

export type CostPolicy = {
  externalCallsEnabled: boolean;
  emergencyKillSwitch: boolean;
  maxEstimatedCostUnitsPerCall: number;
  globalDailyCostUnits: number;
  globalMonthlyCostUnits: number;
  perDeviceDailyCostUnits: number;
  maxRequestsPerMinutePerDevice: number;
};

export type UsageScope = {
  deviceId: string;
  now: Date;
};

export type UsageEntry = {
  id: string;
  deviceId: string;
  service: ExternalApiService;
  estimatedCostUnits: number;
  reservedAtIso: string;
  status: 'reserved' | 'committed' | 'released';
};

export type UsageSnapshot = {
  entries: UsageEntry[];
};

export type CostDecision =
  | { allowed: true; reservation: UsageEntry }
  | {
      allowed: false;
      reason:
        | 'external_calls_disabled'
        | 'kill_switch_active'
        | 'invalid_cost_estimate'
        | 'per_call_limit'
        | 'global_daily_limit'
        | 'global_monthly_limit'
        | 'device_daily_limit'
        | 'device_rate_limit';
    };
