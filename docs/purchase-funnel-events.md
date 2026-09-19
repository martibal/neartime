# NearTime purchase funnel analytics contract

This document describes the launch analytics contract. It must remain subordinate to the live billing/quota implementation and Google Play privacy declarations.

## Principles

- No raw GPS, address, query text, place names, email, name, or NearTime account profile is stored for funnel analytics.
- The server uses a pseudonymous/hashed anonymous installation identifier for quota and funnel correlation.
- Purchase events are derived from server-verified entitlement state, not trusted client assertions.
- Event writes must be idempotent.
- Purchase history/entitlement data used for funnel analytics must be disclosed consistently in the Privacy Policy and Play Data safety form.

## Current launch SKUs and quotas

Current intended commercial model:

- Free: 5 completed logical searches per anonymous installation.
- Monthly: `neartime_monthly`, target 39 NOK/month, 30 searches per billing period.
- Extra pack: `neartime_search_pack_20`, target 19 NOK, 20 extra searches; requires an active/grace monthly subscription.

A completed free search consumes one free-search unit whether it returns 0, 5 or 10 qualifying places. Result count is not a second quota gate.

Technical/provider failures that do not complete normally do not consume a logical search under the current quota policy.

During development, the backend free-search gate remains intentionally high. The Android `X of 5 used` display is a temporary observer of the real counter, not an enforced five-search limit.

## Events

### `trial_started`

Emitted once when an installation begins its first eligible free search.

Required context: installation hash and event timestamp.

### `trial_search_completed`

Emitted after a free search completes normally and consumes one free-search unit, independent of result count.

Required context:

- installation hash;
- completed-search number;
- event timestamp;
- optional result-count bucket/field if needed for product analysis.

A 0-result completed search still counts as one completed search.

Technical/provider failures are separate failure events and do not count as completed free searches under the current quota policy.

### `trial_exhausted`

Emitted once when the production free allowance reaches five completed searches.

There is one user-visible production free-search gate: completed-search count. Do not reintroduce a hidden success-count versus attempt-count limit.

### `purchase_completed`

Emitted only after the store transaction has been verified server-side and the entitlement has been activated/synchronized.

Required context: installation hash, SKU, activation timestamp, expiry timestamp where applicable and purchase sequence.

### `first_purchase_sku`

Derived once from the first verified `purchase_completed` event for an installation.

### `repurchase_sku`

Derived for every verified purchase after the first.

Required context: previous SKU, new SKU and purchase sequence.

### `days_since_first_purchase`

Derived on repurchase from authoritative server timestamps. Do not accept this value from the client.

## Metrics to replace planning assumptions

Once launch traffic exists, the economics model should progressively replace benchmark assumptions with:

1. observed trial-to-paid conversion;
2. observed first-purchase SKU mix;
3. observed quota utilization;
4. observed provider calls/cost per completed search;
5. observed repurchase rate and SKU path;
6. observed days to repurchase.

Do not revise launch economics because of small-sample noise. Benchmarks remain planning inputs until enough observed conversions exist to make replacement statistically useful.

## Authorization boundary

Logical-search quota and provider-cost authorization are separate:

- the logical-search quota answers whether the user is entitled to another NearTime search;
- the provider-cost gate answers whether NearTime has pre-authorized enough provider spend for that request.

A user-visible quota must never replace the provider cost gate, and provider cost capacity must never silently grant additional user-visible searches beyond the purchased/free quota.
