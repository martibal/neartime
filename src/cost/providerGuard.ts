import type { CostDecision } from './types';

export class ExternalCallBlockedError extends Error {
  constructor(reason: string) {
    super(`External API call blocked: ${reason}`);
    this.name = 'ExternalCallBlockedError';
  }
}

export async function runReservedExternalCall<T>(
  decision: CostDecision,
  execute: () => Promise<T>,
): Promise<T> {
  if (!decision.allowed) {
    throw new ExternalCallBlockedError(decision.reason);
  }

  return execute();
}
