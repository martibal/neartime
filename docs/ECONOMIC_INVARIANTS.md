# NearTime economic invariants

These are permanent product and architecture requirements. They are not targets, heuristics, temporary development assumptions, or values that may be relaxed to make a feature work.

## Invariant 1 — every customer must be contribution-positive by construction

NearTime must be designed so that no possible usage pattern by one customer can make that customer contribution-negative for a billing period.

This is stronger than merely preventing runaway API spend. The system must guarantee before billable provider work is admitted that the customer's total attributable variable cost remains below the conservative net revenue actually available from that customer for the same billing period.

The relevant revenue base is not headline subscription price. It is conservative net customer revenue after unavoidable transaction/store deductions, taxes where applicable, refunds/chargeback allowance, and any other attributable variable costs that must be paid before provider COGS.

Provider COGS must therefore consume only an explicitly funded customer cost wallet that is strictly smaller than conservative net customer revenue. The ratio allocated to provider COGS must be configured below 100%, leaving a positive contribution margin by construction.

A subscription, search quota, top-up, feature, ranking mode, retry policy, fallback path, or provider integration is invalid if any allowed customer usage pattern can spend more than the customer's funded provider-cost wallet.

If the remaining funded provider-cost wallet is insufficient, no further billable provider work may begin for that customer until a new funded entitlement period or paid top-up provides additional cost coverage.

## Invariant 2 — per-search cost is derived from customer economics, never chosen as a standalone ceiling

There is no fixed NOK-per-search ceiling that can make an otherwise loss-making plan acceptable.

The maximum admissible worst-case cost of one logical search must be derived from the customer's remaining funded provider-cost wallet and the product's promised remaining usage entitlement.

If a plan promises N remaining included searches in the billing period, the server must preserve enough funded provider budget for all N. A search may therefore reserve at most the conservative budget available for one of those remaining searches, unless the product contract explicitly allows a different usage-allocation rule that still guarantees positive customer contribution under every allowed usage pattern.

If the product is marketed as unlimited search, then NearTime can only guarantee this invariant if marginal provider cost is effectively bounded near zero through caching/precomputation/owned data, or if paid usage beyond a funded threshold is separately monetized. 'Unlimited billable provider calls for a fixed low subscription price' is incompatible with this invariant.

Measured searches costing dollars each are therefore not merely expensive; they are evidence that the current search architecture is commercially invalid for a low-price consumer subscription and must be redesigned.

## Invariant 3 — coverage and economics are both hard constraints

NearTime's completeness requirement does not override the economic invariant, and the economic invariant does not permit silently incomplete results.

The only valid outcomes are:

- complete/proven result inside the customer's funded economic limits; or
- fail closed (`DEGRADED`) before those limits can be exceeded.

Returning an arbitrary/truncated set as complete is forbidden. Spending beyond the customer's funded limits to obtain completeness is also forbidden.

## Required admission order

Before any billable provider work begins, the server must determine and atomically reserve the conservative worst case for the logical search and verify all of the following:

1. the customer has conservative net revenue available for the current billing period;
2. a configured provider-COGS allocation smaller than that net revenue has funded the customer's provider-cost wallet;
3. the worst-case cost of the proposed search fits inside the customer's remaining provider-cost wallet;
4. admitting the search cannot make the customer contribution-negative even if the customer fully exercises all remaining usage rights promised by the plan;
5. retries, fallbacks, concurrency and provider failures are included in the reservation bound.

Only then may the first billable provider call execute.

Actual usage must be committed after the search and unused reservation released. Retries, duplicate requests, concurrency, fallbacks, and provider errors must not create an unreserved path around the invariant.

## Pricing and quota design rule

Pricing, included usage and provider architecture must be designed together.

A plan is not commercially valid until NearTime can prove, using conservative provider prices and conservative net revenue assumptions, that the maximum provider spend permitted by that plan is below the customer's funded provider-cost allocation and therefore leaves a positive contribution margin.

For example, a low-price monthly plan cannot include a volume of live searches whose worst-case cumulative provider cost could exceed the plan's conservative net proceeds. If the desired customer experience requires that volume, the provider cost per search must be reduced, the included usage must be reduced, the plan price must increase, or paid top-ups/usage charges must cover the excess. The system may not rely on 'average users probably search less'.

## Engineering gate

No production feature that can cause billable provider traffic is complete until tests demonstrate its worst-case admission bound and fail-closed behavior at both search level and billing-period/customer level.

Live probes are validation tools only. A large test wallet must never be interpreted as an acceptable production unit cost.

The production feature gate must remain closed until the search architecture, product pricing and usage entitlement together satisfy the customer-profit invariant with conservative assumptions.
