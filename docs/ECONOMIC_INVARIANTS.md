# NearTime economic invariants

These are permanent product and architecture requirements. They are not targets, heuristics, temporary development assumptions, or values that may be relaxed to make a feature work.

## Invariant 1 — a customer may never cost more than they earn

NearTime must be designed so that the maximum provider cost attributable to one customer can never exceed the net revenue allocated to that customer for the same billing period.

This must be enforced before provider calls are made, not checked after the fact.

A subscription, search quota, top-up, feature, ranking mode, retry policy, fallback path, or provider integration is invalid if its worst-case provider COGS can exceed the funded customer revenue available to cover it.

If the remaining funded margin is insufficient, the request must fail closed before any additional billable provider work begins.

## Invariant 2 — one logical search must never cost more than NOK 10 in provider COGS

NOK 10 is an absolute per-search ceiling, not an expected average.

A search plan may only be admitted when NearTime can prove before execution that the worst-case provider cost for that logical search is at or below the NOK 10 ceiling.

If a search algorithm, filter combination, ranking mode, retry path, or fallback cannot be completed within that ceiling, NearTime must return a fail-closed/degraded result or use a cheaper architecture. It must never continue spending past the ceiling in order to preserve completeness.

Provider prices may be denominated in another currency. Production enforcement therefore requires a conservative conversion policy that cannot understate the NOK equivalent. The conversion mechanism itself must be documented and tested before paid production traffic is enabled.

## Invariant 3 — coverage and economics are both hard constraints

NearTime's completeness requirement does not override the cost ceiling, and the cost ceiling does not permit silently incomplete results.

The only valid outcomes are:

- complete/proven result inside the economic limits; or
- fail closed (`DEGRADED`) before the economic limits can be exceeded.

Returning an arbitrary/truncated set as complete is forbidden. Spending beyond the economic limits to obtain completeness is also forbidden.

## Required admission order

Before any billable provider work begins, the server must determine and atomically reserve the conservative worst case for the logical search and verify both:

1. per-search worst-case provider COGS <= NOK 10 equivalent; and
2. the customer's remaining funded provider-cost budget after reservation cannot exceed the net revenue allocated to that customer for the billing period.

Only then may the first billable provider call execute.

Actual usage must be committed after the search and unused reservation released. Retries, duplicate requests, concurrency, fallbacks, and provider errors must not create an unreserved path around either invariant.

## Engineering gate

No production feature that can cause billable provider traffic is complete until tests demonstrate its worst-case admission bound and fail-closed behavior.

Live probes are validation tools, not a license to spend up to their test-wallet size. A test wallet larger than the commercial per-search ceiling must never be interpreted as an acceptable production search cost.

Any measured live search above NOK 10 equivalent is a product/architecture failure that must trigger redesign before that path is eligible for production.
