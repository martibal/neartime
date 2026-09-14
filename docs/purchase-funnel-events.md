# NearTime purchase funnel analytics contract

This document freezes the launch analytics contract before payment UI and store purchase code are added.

## Principles

- No raw GPS, address, query text, place names, email, name, or account profile is stored for funnel analytics.
- The server hashes the anonymous installation identifier before persistence.
- Purchase events are derived from server-verified entitlement state, not trusted client assertions.
- Event writes are idempotent through `(install_hash, event_key)`.
- `first_purchase_sku`, repurchase paths, and timing must be reconstructable from authoritative purchase history from day one.

## Launch SKUs and quotas

Commercial launch guardrails are:

- Free: 3 successful searches, maximum 5 eligible attempts.
- Trip Pass 3 days: 29 NOK, 5 searches.
- Monthly: 39 NOK, 9 searches.
- Trip Pass 7 days: 49 NOK, 11 searches. This is the highlighted `Best value` option.

The 3-day pass is not treated as an acquisition-cost product. Any later CAC/LTV interpretation requires observed repurchase data.

## Events

### `trial_started`
Emitted once when an installation begins its first eligible free search.

Required context: installation hash, event timestamp.

### `trial_search_success`
Emitted after a free search produces at least one qualifying result and consumes one of the three successful free searches.

Required context: installation hash, successful search number 1-3, event timestamp.

Technical/provider failures do not count as successful free searches.

### `trial_exhausted`
Emitted once when the free allowance can no longer continue.

`exhaustion_reason` is either:

- `success_limit`
- `attempt_limit`

### `purchase_completed`
Emitted only after the store transaction has been verified server-side and the entitlement has been activated/synchronized.

Required context: installation hash, SKU, activation timestamp, expiry timestamp where applicable, purchase sequence.

### `first_purchase_sku`
Derived once from the first verified `purchase_completed` event for an installation.

This is the primary source for observed launch product mix.

### `repurchase_sku`
Derived for every verified purchase after the first.

Required context: previous SKU, new SKU, purchase sequence.

### `days_since_first_purchase`
Derived on repurchase from authoritative server timestamps.

Do not accept this value from the client.

### `trip_to_monthly_conversion`
Derived when a verified repurchase transitions from a Trip Pass SKU to Monthly.

This is the evidence required before a Trip Pass can be discussed as an acquisition product.

## Metrics to replace planning assumptions

Once launch traffic exists, the economics model should progressively replace benchmark assumptions with:

1. observed trial-to-paid conversion;
2. observed first-purchase SKU mix;
3. observed quota utilization;
4. observed provider calls per search;
5. observed repurchase rate and SKU path;
6. observed Trip Pass to Monthly conversion;
7. observed days to repurchase.

Do not revise launch economics because of small-sample noise. Benchmarks remain planning inputs until there are enough observed conversions to make the replacement statistically useful.

## Next implementation boundary

The next backend step is to implement the anonymous free-trial allowance and the paid logical-search quota as separate authorization layers from the provider-cost wallet.

This separation is intentional:

- the logical-search quota answers whether the user is entitled to another NearTime search;
- the provider-cost wallet answers whether NearTime has pre-authorized enough money/cost units to make the external Google calls safely.

A user-visible quota must never replace the provider cost gate, and provider cost balance must never silently grant additional user-visible searches beyond the purchased SKU quota.
