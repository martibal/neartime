# NearTime live search backend

The mobile app must never call a billable Google Places web-service endpoint directly. `api/search.js` is the server-side boundary and the Supabase reservation function is the authoritative cost gate.

## Request path

1. Mobile sends query + current origin to the NearTime backend.
2. Backend calls `reserve_api_cost` in Supabase.
3. Supabase locks the service policy row and atomically checks per-call, global daily/monthly, per-device daily, rate-limit and kill-switch gates.
4. Only an allowed reservation permits the Google request.
5. Backend performs one Places API (New) Nearby Search with `routingSummaries`, so the same response contains the actual travel duration/distance for the selected Walk / Drive / Bike mode.
6. Successful provider calls are committed in the ledger; provider failures are released. Stale reservations expire after five minutes and remain conservatively counted until expiry.

## Default state

The migration inserts `places-nearby-enterprise-atmosphere` with `external_calls_enabled=false`, `emergency_kill_switch=true`, and all quotas at zero. Applying the migration therefore cannot create Google Places spend.

## Server-only environment variables

Set these only on the backend deployment. Never expose them with `EXPO_PUBLIC_`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_PLACES_SERVER_API_KEY`

The Google server key should be a separate key from the Android Maps SDK key and restricted to the Places API (New).

## Mobile environment variable

Set the public backend endpoint in the Expo development environment:

`EXPO_PUBLIC_NEARTIME_SEARCH_ENDPOINT=https://<backend-host>/api/search`

## Controlled development unlock

Do not unlock until the migration is applied, the backend secrets exist, and the Google server key is API-restricted. For a tiny technical spike, use deliberately small limits, for example:

```sql
update public.api_cost_policy
set external_calls_enabled = true,
    emergency_kill_switch = false,
    max_estimated_units_per_call = 1,
    global_daily_units = 5,
    global_monthly_units = 20,
    per_device_daily_units = 5,
    max_requests_per_minute_per_device = 2,
    updated_at = now()
where service = 'places-nearby-enterprise-atmosphere';
```

Re-enable the emergency stop at any time with:

```sql
update public.api_cost_policy
set emergency_kill_switch = true,
    updated_at = now()
where service = 'places-nearby-enterprise-atmosphere';
```

## Important implementation property

NearTime does not estimate travel time from straight-line distance. Nearby Search routing summaries provide a routing duration for the selected travel mode, and the backend applies the user's maximum travel-time filter against that duration before returning results.
