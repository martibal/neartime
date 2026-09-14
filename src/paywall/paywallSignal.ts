type PaywallReason = 'trial_exhausted' | 'paid_quota_exhausted' | 'entitlement_required';

type Listener = (reason: PaywallReason) => void;

const listeners = new Set<Listener>();

export function requestPaywall(reason: PaywallReason = 'trial_exhausted'): void {
  for (const listener of listeners) listener(reason);
}

export function subscribePaywall(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
