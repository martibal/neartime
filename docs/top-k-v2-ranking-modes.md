# NearTime v2.0 ranking modes

NearTime returns the **best 20 matches for the user's selected priority**, not an exhaustive catalogue. `COMPLETE_TOP_K` means the backend has proved that no unexamined candidate can outrank the returned Top K under the selected ranking rule. `DEGRADED` means that proof could not be completed within provider, geometry or cost bounds.

The three supported ranking modes are:

- `RATING`: highest Google rating first.
- `PRICE`: lowest known Google `priceLevel` first.
- `TRAVEL_TIME`: shortest routed travel time first.

All three modes use the same proof contract and the same fail-closed rule.

## Shared pipeline

`Isochrone -> Aggregate proof/filtering -> bounded candidate materialization -> only necessary routing/enrichment -> COMPLETE_TOP_K`

Places Aggregate remains the coverage/count authority. Text Search is supplemental only when semantic text retrieval is required.

## Rating

The planner walks descending cumulative rating thresholds. If the first qualifying bucket is exactly 5.0, every candidate is tied on the user's selected ranking criterion, so the proof stage can choose a deterministic K-subset without Place Details. If the selected threshold spans more than one rating value, Details are used only for the bounded candidate set needed to establish exact order.

## Price

Price uses exact discrete Aggregate buckets in ascending order:

`FREE -> INEXPENSIVE -> MODERATE -> EXPENSIVE -> VERY_EXPENSIVE`

Each bucket is counted and materialized only until K candidates have been proved. Candidates with no Google `priceLevel` are excluded from `PRICE` ranking because they cannot be ordered as cheapest or most expensive without inventing data. Equal price-level candidates are tied and selected deterministically by Place ID.

## Travel time

Travel time uses progressively larger Google isochrones. Aggregate counts each reachable envelope first. No candidate materialization or route call occurs while the envelope contains fewer than K candidates, unless the user's maximum travel time has been reached.

When an envelope becomes proof-worthy, its bounded candidate set is materialized and exact Route Matrix duration is computed. Route results are cached across larger envelopes. The first envelope that contains at least K candidates after exact routing proves the Top K. If the maximum travel time is reached with fewer than K exact matches, all exact matches are returned as `COMPLETE_TOP_K`.

The current exact travel-time path fails closed for isochrone holes or multiple polygon shells rather than silently weakening coverage.

## Cost reservation

The planner exposes a worst-case plan before provider calls. Wallet admission should reserve against conservative paid list-price assumptions, including:

`max envelope calls + max Aggregate calls + max proof Details + max Route Matrix elements + finalist Details`

Finalist Details are budgeted separately from proof-stage Details. A proof can therefore use zero Details while the final customer-facing result still reserves up to K Details calls to render the 20 result cards.

This keeps the economic invariant explicit: a search is admitted only when its full worst-case provider spend fits inside the customer's funded cost envelope.
