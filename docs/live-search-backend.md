# NearTime live search backend

The mobile app must never call a billable Google Places web-service endpoint directly. `api/search.js` is the server-side boundary and the Supabase reservation function is the authoritative cost gate.

## Query semantics

NearTime treats every user criterion as a hard `WHERE` condition. The result set is conceptually:

```sql
SELECT TOP 20 *
FROM places
WHERE category = :category
  AND travel_time_minutes <= :max_minutes
  AND rating >= :minimum_rating
  AND review_count >= :minimum_reviews
  AND open_now = :open_now
  AND minutes_until_close >= :minimum_open_minutes
ORDER BY travel_time_minutes ASC;
```

The backend never fills the list with a place that violates a hard filter. Fewer than 20 matches is valid.

## Candidate acquisition

Google Nearby Search (New) is limited to 20 results and does not paginate. NearTime therefore uses Places Text Search (New), which supports pages of up to 20 and up to 60 results across pages.

For each NearTime search the backend:

1. restricts the search to a conservative geographic envelope around the origin;
2. asks Google for the selected category with strict type filtering and distance ranking;
3. pushes safe filters such as `openNow` and a non-excluding minimum-rating floor into Google;
4. requests `routingSummaries` for the selected Walk / Drive / Bike mode;
5. follows at most two `nextPageToken` values, so one user search can make at most three billable Places requests;
6. deduplicates candidates by Google place ID;
7. reapplies every NearTime hard filter locally using the returned place and routing data;
8. sorts qualified places by actual routed travel time and returns the first 20.

This is materially stronger than taking Google's first 20 places and filtering afterward. Google Text Search itself has a 60-result ceiling, so the backend must not claim exhaustive coverage beyond Google's bounded candidate set. `providerResultLimitReached` is returned as backend metadata when the provider still advertises another page at the configured hard stop.

## Cost invariant

No Google request may run without pre-authorized cost capacity.

A NearTime search reserves **3 units before the first provider call**, equal to the absolute maximum of three Google Text Search requests. If the gate cannot reserve all three units, the entire search fails closed before Google is contacted.

After the search finishes, `finish_api_cost_reservation_v2` reduces the committed ledger amount to the number of successful billable provider calls actually made. Unused reserved capacity is therefore returned to the quota. If a later page fails after earlier Google calls succeeded, those successful calls are still committed so provider spend cannot disappear from the ledger.

The gate continues to enforce per-call, global daily/monthly, per-device daily, rate-limit and emergency-stop limits atomically.

## Default state

Migration `20260914_002_bounded_text_search_gate.sql` inserts `places-text-search-enterprise-atmosphere` with:

- `external_calls_enabled = false`
- `emergency_kill_switch = true`
- all quotas = `0`

It also disables the retired `places-nearby-enterprise-atmosphere` policy. Applying the migration therefore cannot create Google Places spend.

## Server-only environment variables

Set these only on the backend deployment. Never expose them with `EXPO_PUBLIC_`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_PLACES_SERVER_API_KEY`

The Google server key should be separate from the Android Maps SDK key and restricted to Places API (New).

## Mobile environment variable

Set the public backend endpoint in the Expo environment:

`EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT=https://<backend-host>/api/search`

## Controlled development unlock

Do not unlock until the migration is applied, backend secrets exist, and the Google server key is API-restricted. Because one NearTime search can reserve three provider-call units, `max_estimated_units_per_call` must be at least `3` when controlled testing is intentionally enabled.

Example tiny test envelope:

```sql
update public.api_cost_policy
set external_calls_enabled = true,
    emergency_kill_switch = false,
    max_estimated_units_per_call = 3,
    global_daily_units = 6,
    global_monthly_units = 6,
    per_device_daily_units = 3,
    max_requests_per_minute_per_device = 1,
    updated_at = now()
where service = 'places-text-search-enterprise-atmosphere';
```

That permits at most one fully reserved search per device per day and at most two fully reserved searches globally under the example envelope. Production limits must ultimately be derived from paid customer revenue and the required gross-margin floor, not from arbitrary request counts.

Re-enable the emergency stop at any time with:

```sql
update public.api_cost_policy
set emergency_kill_switch = true,
    updated_at = now()
where service = 'places-text-search-enterprise-atmosphere';
```

## Travel modes

Version 1 supports only:

- Walk
- Bike
- Drive

Actual eligibility uses Google's routed duration for the selected mode. Straight-line distance is never used as the travel-time decision. Transit is intentionally excluded because destination discovery plus schedule-dependent multimodal routing has a different cost and search architecture.
