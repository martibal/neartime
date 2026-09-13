# NearTime external API cost-safety contract

This is a permanent architecture rule, not a temporary development convention.

## Non-negotiable rule

No billable external API call may be executed unless cost coverage has been authorized first.

The required order is:

1. Determine which external service would be called.
2. Estimate the maximum cost/quota units for that call.
3. Check the emergency kill switch.
4. Check the per-call cap.
5. Check global daily and monthly caps.
6. Check per-device daily cap and request-rate limit.
7. Atomically reserve the estimated usage.
8. Only after a successful reservation may the provider call run.
9. Commit the reservation after success, or release it after a non-billable failure where appropriate.
10. Provider-side quotas remain a secondary circuit breaker, never the primary protection.

## Development state

The current policy is intentionally fail-closed:

- `externalCallsEnabled = false`
- `emergencyKillSwitch = true`
- all cost ceilings = `0`
- the app continues to use local mock place data
- no Google Places or Routes provider is connected

Therefore a code path using the cost gate cannot authorize a billable external call in the current build.

## Components

- `src/cost/policy.ts` — active policy and kill switch.
- `src/cost/gate.ts` — evaluates and reserves a call only when all limits permit it.
- `src/cost/ledger.ts` — usage-ledger calculations and reservation state transitions.
- `src/cost/providerGuard.ts` — refuses provider execution without an allowed reservation.
- `src/cost/types.ts` — shared contracts.

## Production requirement

The current ledger is an in-memory domain model for development and deterministic testing. Before any real paid provider is enabled, reservation and ledger mutation must move to a server-side transactional store so the check-and-reserve operation is atomic across concurrent users and devices. A client-side gate alone is never sufficient cost protection.

No API secret or unrestricted provider credential may be shipped in the mobile client.
