# NearTime production search contract

Effective architecture: 2026-09-19-google-places-v2.

These are release-blocking requirements.

## Customer-visible location and Maps handoff

- A normal search starts from either the device's foreground location or a user-selected custom origin.
- The app does not perform a paid provider search on startup, typing, GPS refresh, filter changes or result sorting.
- "Open in Maps" and walking directions are handed off to Google Maps by URL.
- No local country map, routing graph, Valhalla instance, Docker container or other self-hosted geographic dataset participates in the live Android search path.

## Normal POI search

Each explicit normal POI search performs at most one Google Places request:

- minimum rating = Any: Google Nearby Search (New);
- minimum rating > 0: Google Text Search (New), with the minimum rating sent to Google before Google's candidate limit;
- when Text Search is active and Open now is selected, openNow is also sent provider-side;
- walking route distance/time is returned through Google Places routing summaries in that same Places request.

The backend verifies all selected criteria before returning a place. At most ten places are returned, ordered by measured walking route distance by default.

The Android "Highest rated in results" control is a local re-ordering of the already returned result set. It does not trigger another provider request and does not claim a separate global top-10-by-rating search.

## Candidate-limit semantics

NearTime distinguishes:

- COMPLETE_TOP10: ten qualifying results were established from the provider-returned set;
- PARTIAL_CANDIDATE_LIMIT: fewer than ten qualified after a full provider candidate page and exhaustiveness is not proven;
- EXHAUSTED_GOOGLE_CANDIDATES: Google returned fewer than the configured candidate limit.

The product must not claim that a partial candidate-limited result is globally exhaustive.

## Provider cost guard

The live server records a conservative NOK 0.40 value for one normal Google Places search. The application never performs a second paid Places request to fill a result list.

The cost ledger records, per successful search:

- Google Nearby Search calls;
- Google Text Search calls;
- number of places for which Google returned routing summaries;
- legacy TomTom Discover/Route counters when applicable;
- conservative estimated NOK cost;
- build id and result status.

Routing summaries are part of the same Google Places request in the current architecture; they are not recorded as separate NearTime route API calls.

The conservative estimate is an internal guard, not a claim that every request is invoiced at exactly NOK 0.40. Provider billing/invoices remain the source of truth for actual billed cost.

## Custom start location

Custom-origin lookup is a separate, explicitly user-triggered path:

- "Find place or address" can perform one TomTom Suggest request.
- Selecting one returned suggestion can perform one TomTom Details request.
- No Suggest request is made for every keystroke.
- Reusing the selected custom origin for POI searches does not repeat Suggest/Details automatically.

These calls are tracked separately from normal Google POI searches.

## Retry and idempotency

- One explicit user search maps to one logical search reservation.
- Logical idempotency prevents duplicate quota consumption for the same request id.
- NearTime does not intentionally add a second paid provider request as a retry/fill mechanism.
- Cost telemetry is internal and must never be shown as customer-facing result copy.

## Customer-visible result data

Optional provider fields such as phone number, website, price and business status are omitted when absent. JSON null values and the literal string "null" must never be rendered as customer-visible text.

Google attribution remains visible in the result view:

"Place data and walking routes provided by Google Maps"
