import {
  deviceDailyUsage,
  deviceRequestsLastMinute,
  globalDailyUsage,
  globalMonthlyUsage,
} from './ledger';
import type {
  CostDecision,
  CostPolicy,
  ExternalApiService,
  UsageScope,
  UsageSnapshot,
} from './types';

export type ReserveRequest = {
  service: ExternalApiService;
  estimatedCostUnits: number;
};

export function reserveExternalCall(
  policy: CostPolicy,
  snapshot: UsageSnapshot,
  scope: UsageScope,
  request: ReserveRequest,
): CostDecision {
  if (!policy.externalCallsEnabled) {
    return { allowed: false, reason: 'external_calls_disabled' };
  }

  if (policy.emergencyKillSwitch) {
    return { allowed: false, reason: 'kill_switch_active' };
  }

  if (!Number.isFinite(request.estimatedCostUnits) || request.estimatedCostUnits <= 0) {
    return { allowed: false, reason: 'invalid_cost_estimate' };
  }

  if (request.estimatedCostUnits > policy.maxEstimatedCostUnitsPerCall) {
    return { allowed: false, reason: 'per_call_limit' };
  }

  if (
    globalDailyUsage(snapshot, scope.now) + request.estimatedCostUnits >
    policy.globalDailyCostUnits
  ) {
    return { allowed: false, reason: 'global_daily_limit' };
  }

  if (
    globalMonthlyUsage(snapshot, scope.now) + request.estimatedCostUnits >
    policy.globalMonthlyCostUnits
  ) {
    return { allowed: false, reason: 'global_monthly_limit' };
  }

  if (
    deviceDailyUsage(snapshot, scope.deviceId, scope.now) + request.estimatedCostUnits >
    policy.perDeviceDailyCostUnits
  ) {
    return { allowed: false, reason: 'device_daily_limit' };
  }

  if (
    deviceRequestsLastMinute(snapshot, scope.deviceId, scope.now) >=
    policy.maxRequestsPerMinutePerDevice
  ) {
    return { allowed: false, reason: 'device_rate_limit' };
  }

  const reservation = {
    id: `${scope.deviceId}:${scope.now.getTime()}:${request.service}`,
    deviceId: scope.deviceId,
    service: request.service,
    estimatedCostUnits: request.estimatedCostUnits,
    reservedAtIso: scope.now.toISOString(),
    status: 'reserved' as const,
  };

  return { allowed: true, reservation };
}
