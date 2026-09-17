# NearTime economic invariants

These are permanent product and architecture requirements.

## Invariant 1 — a customer may never cost more than they earn

The maximum provider cost attributable to one customer may never exceed the net revenue allocated to that customer for the same billing period. Admission must fail closed before provider work begins when funded margin is insufficient.

## Invariant 2 — one normal place search may never exceed NOK 0.30 provider COGS

NOK 0.30 is an absolute per-search ceiling, not an average.

The production implementation must conservatively bound the entire logical search. Free tiers, promotional credits and temporary discounts may not be used to make the bound pass.

If the requested search cannot return a provably correct result inside NOK 0.30, it must return DEGRADED; it may not continue spending.

## Invariant 3 — correctness and economics are simultaneous hard constraints

The cost ceiling does not permit NearTime to silently return a non-Top-10 result. Correctness does not permit NearTime to spend beyond the cost ceiling.

The valid outcomes are a complete/proven result inside NOK 0.30, or DEGRADED before the ceiling is exceeded.

## International/freshness invariant

Production search may not depend on locally downloaded country maps or routing graphs. Customer map display, POI retrieval and route calculation must use internationally available online services and current device location.

## Engineering gate

Any production provider path must have automated tests for maximum paid-call count, worst-case NOK cost calculation, fail-closed behavior at the ceiling, ranking by measured route distance, and absence of local routing/map dataset dependencies.
