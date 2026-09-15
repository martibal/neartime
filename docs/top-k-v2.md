# NearTime v2.0 — verified Top-K search

## Product contract

NearTime does not promise to show every place that qualifies. It promises to show the **best 20 matches for the user's selected priority**, provided that result can be proven complete under the supported candidate universe and cost envelope.

Customer-facing wording should reflect this directly:

> **Your best 20** — ranked by what matters to you.

For example:

> Cafe · within 15 minutes · prioritize rating

A place 13 minutes away may outrank a place 5 minutes away when the user chooses rating as the priority. Expanding a search from 10 to 15 minutes can therefore legitimately change the Top 20 even when many nearby places are common to both searches.

The Top-20 limit is a product feature, not a fallback or truncation message. NearTime simplifies the choice set instead of handing the user a long catalogue to inspect manually.

## Result states

`COMPLETE_TOP_K` means:

- the supported candidate universe for the search has been bounded by the travel-time envelope and hard filters;
- NearTime has proved that no unexamined candidate can outrank the returned Top K under the selected ranking rule;
- the returned list is the actual Top K under that rule, or all matches when fewer than K exist.

`DEGRADED` means the Top-K proof could not be completed inside a safety, provider or cost bound. A partial list must never be presented as complete.

This intentionally replaces the older meaning of COMPLETE as "every qualifying place is displayed". Completeness now applies to the ranked Top-K result.

## Provider responsibilities

- **Google Isochrones API**: travel-time envelope.
- **Places Aggregate API**: coverage/count authority and server-side filters for type, rating, price and operating status.
- **Text Search (New)**: supplemental semantic retrieval only when query semantics require it. It is not the primary coverage authority where Aggregate can express the filter.
- **Place Details / Routes**: enrichment and exact ranking only for candidates that can still enter Top K.

Raw isochrone output must not be passed straight into Aggregate. The handoff must normalize closure, winding, duplicates, provider vertex limits and minimum area. Any future polygon simplification must preserve coverage or fail closed; ordinary simplification is not assumed coverage-safe.

## First ranking mode: rating

The first implementation uses rating because Aggregate can filter it directly with raw floating-point `minRating` / `maxRating` values.

The proof planner queries cumulative descending thresholds, for example:

`5.0 -> 4.9 -> 4.8 -> 4.7 ... -> 1.0`

At each threshold Aggregate returns an exact count for the entire search polygon. The planner stops when either:

1. the cumulative set contains at least K candidates; or
2. the 1.0 threshold proves that fewer than K rated places exist.

Only then are Place IDs materialized and Details requested. The exact result order is:

1. rating descending;
2. user rating count descending;
3. Place ID ascending as deterministic final tie-break.

If the candidate set that must be materialized exceeds the configured Details cap, the planner returns `DEGRADED` before issuing Details calls. The cap is a cost-safety boundary, not permission to return an unverified partial list.

A live pre-production test must verify the provider behavior for unrated places under an active `minRating`. The code currently fails closed if a supposedly rating-filtered candidate is materialized without a qualifying rating.

## Cost model

The old worst case scaled with local density:

`all candidates -> Details for all -> routing for all -> sort -> discard most`

The v2.0 model scales with the proof plan:

`isochrone + Aggregate proof calls + bounded candidate materialization + finalist enrichment + finalist routing`

Before expensive work starts, the wallet must reserve a conservative worst-case provider cost for the selected ranking mode:

`coverage + bucket calls + candidate materialization + max finalist enrichment + max routing`

Free provider allowances are a billing bonus only. Admission control must use conservative paid list-price assumptions so one customer cannot consume more provider cost than the revenue budget assigned to that customer.

## Future ranking modes

- **Price**: use Aggregate price-level filters and prove Top K by price bands before enrichment.
- **Shortest travel time**: progressively tighten/expand isochrone envelopes to prune candidates, then use Route Matrix only where exact ordering is still required.
- **Composite ranking**: do not introduce free-form weights until each component has a provable bound and deterministic tie-breaking rule.
