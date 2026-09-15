# NearTime external API cost-safety contract

This is a permanent architecture rule, not a temporary development convention.

## Non-negotiable economic constraints

This document is subordinate to the permanent economic contract in [`ECONOMIC_INVARIANTS.md`](ECONOMIC_INVARIANTS.md).

Two limits are absolute:

1. A customer's cumulative provider/API cost may never exceed the net revenue allocated to that customer for the same billing period.
2. One logical customer search may never exceed NOK 10 equivalent in provider COGS.

Both limits must be enforced **before** provider calls are made using a conservative worst-case reservation. A path that cannot prove it will remain inside both limits must fail closed before billable work begins.

Coverage is not allowed to override these limits. Cost is not allowed to justify silently incomplete results. The valid outcome is either a complete/proven result inside the limits or `DEGRADED`/fail-closed.

## Non-negotiable call rule

No billable external API call may be executed unless cost coverage has been authorized first.

The required order is:

1. Determine which external service would be called.
2. Estimate the conservative maximum provider cost for the complete logical search, including retries/fallbacks.
3. Convert that maximum conservatively to NOK when provider pricing is denominated in another currency.
4. Reject the search if worst-case provider COGS can exceed NOK 10 equivalent.
5. Reject the search if reservation could make the customer's billing-period provider cost exceed net customer revenue allocated to cover it.
6. Check the emergency kill switch.
7. Check the per-call and provider-specific caps.
8. Check global daily and monthly caps.
9. Check per-device daily cap and request-rate limit.
10. Atomically reserve the full approved worst-case usage.
11. Only after a successful reservation may the provider call run.
12. Commit actual usage after success, or release unused reservation after a non-billable failure where appropriate.
13. Provider-side quotas remain a secondary circuit breaker, never the primary protection.

Retries, duplicate requests, parallel requests, fallback providers, and error recovery must never bypass the reservation or create an unbounded spend path.

## Development state

The current policy is intentionally fail-closed by default:

- external calls require explicit temporary/production enablement
- the emergency kill switch can block provider work
- provider COGS is reserved before billable work
- production eligibility additionally requires compliance with the NOK 10 per-search ceiling and customer-period revenue invariant

A large test wallet is only a testing mechanism. It does **not** redefine an acceptable production search cost. Any live probe measured above NOK 10 equivalent is an architecture failure for that search path and must trigger redesign before production use.

## Components

- `src/cost/policy.ts` — active policy and kill switch.
- `src/cost/gate.ts` — evaluates and reserves a call only when all limits permit it.
- `src/cost/ledger.ts` — usage-ledger calculations and reservation state transitions.
- `src/cost/providerGuard.ts` — refuses provider execution without an allowed reservation.
- `src/cost/types.ts` — shared contracts.
- server-side wallet/provider reservation logic — production enforcement for paid traffic.

## Production requirement

Before ordinary paid provider traffic is enabled, the server-side admission layer must enforce both permanent economic invariants atomically across concurrent users and devices. A client-side gate alone is never sufficient cost protection.

No API secret or unrestricted provider credential may be shipped in the mobile client.
