import type { UsageEntry, UsageSnapshot } from './types';

function startOfUtcDay(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function startOfUtcMonth(now: Date) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function activeCost(entries: UsageEntry[]) {
  return entries
    .filter((entry) => entry.status !== 'released')
    .reduce((sum, entry) => sum + entry.estimatedCostUnits, 0);
}

export function emptyUsageSnapshot(): UsageSnapshot {
  return { entries: [] };
}

export function globalDailyUsage(snapshot: UsageSnapshot, now: Date) {
  const start = startOfUtcDay(now);
  return activeCost(snapshot.entries.filter((entry) => Date.parse(entry.reservedAtIso) >= start));
}

export function globalMonthlyUsage(snapshot: UsageSnapshot, now: Date) {
  const start = startOfUtcMonth(now);
  return activeCost(snapshot.entries.filter((entry) => Date.parse(entry.reservedAtIso) >= start));
}

export function deviceDailyUsage(snapshot: UsageSnapshot, deviceId: string, now: Date) {
  const start = startOfUtcDay(now);
  return activeCost(
    snapshot.entries.filter(
      (entry) => entry.deviceId === deviceId && Date.parse(entry.reservedAtIso) >= start,
    ),
  );
}

export function deviceRequestsLastMinute(snapshot: UsageSnapshot, deviceId: string, now: Date) {
  const threshold = now.getTime() - 60_000;
  return snapshot.entries.filter(
    (entry) =>
      entry.deviceId === deviceId &&
      entry.status !== 'released' &&
      Date.parse(entry.reservedAtIso) >= threshold,
  ).length;
}

export function appendReservation(snapshot: UsageSnapshot, reservation: UsageEntry): UsageSnapshot {
  return { entries: [...snapshot.entries, reservation] };
}

export function updateReservationStatus(
  snapshot: UsageSnapshot,
  reservationId: string,
  status: UsageEntry['status'],
): UsageSnapshot {
  return {
    entries: snapshot.entries.map((entry) =>
      entry.id === reservationId ? { ...entry, status } : entry,
    ),
  };
}
