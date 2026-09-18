# NearTime — Play Data Safety working draft

Last reviewed: 2026-09-19.

This is a submission worksheet, not a substitute for the Play Console form. Reconcile every answer against the exact release APK/AAB and the current Google definitions immediately before submission.

## Current architecture relevant to Data Safety

- Foreground Android location is optional.
- Current-location search sends the chosen origin to NearTime's HTTPS Supabase Edge Function.
- The backend sends location/search parameters to Google Places API (Nearby Search) to obtain nearby place data and walking routing summaries.
- Custom place/address entry is sent through the NearTime backend to TomTom suggestion/details services.
- NearTime's search-cost ledger intentionally stores operational search/cost metadata but not the user's origin latitude/longitude, typed address, or place names.
- The Android project includes Google Maps Platform components. Re-check the final SDK inventory because Google SDKs may collect their own technical/diagnostic data.

## Suggested Play Data Safety answers

| Data type | Collected? | Shared? | Ephemeral? | Required? | Main purpose / notes |
| --- | --- | --- | --- | --- | --- |
| Approximate location | Yes when granted/available | Re-check provider classification before submission | NearTime app database: intended to be ephemeral | Optional | App functionality: nearby search and walking results |
| Precise location | Yes when user grants precise location | Re-check provider classification before submission | NearTime app database: intended to be ephemeral | Optional | App functionality: more accurate nearby search |
| Other user-generated content: custom place/address text | Yes when user uses custom origin | Re-check TomTom/provider classification | Intended to be ephemeral in NearTime application storage | Optional | App functionality: resolve a user-selected origin |
| App interactions: category/filter/search operation | Yes | Normally not intentionally disclosed beyond service providers | No — limited operational fields can be retained | Required for a search | App functionality, reliability, API-cost control |
| Diagnostics / device or other identifiers from third-party SDKs | Verify in final SDK inventory | Verify | Provider-dependent | Provider-dependent | Google Maps Platform documentation may require disclosure of technical/diagnostic collection |

## Important interpretation notes

1. Google defines data as **collected** when it is transmitted off the device. Therefore location must not be marked “not collected” merely because NearTime does not persist coordinates.
2. If data is processed only in memory to fulfil a real-time request and discarded, Play may treat that use as ephemeral, but it still needs to be considered in the form.
3. Whether a provider transfer is marked **shared** depends on Google's current exemptions and the provider's legal role. Do not guess this at submission time; confirm the current Google Maps Platform, TomTom and Supabase terms and the Play Data Safety definitions.
4. Current NearTime search-cost telemetry includes category/filter settings, timestamps, random request IDs, result status/count, provider call/cost metrics and build IDs. It is deliberately designed not to store origin coordinates, typed address queries or place names.
5. If crash reporting, analytics, advertising, login/accounts, payments, push notifications or persistent search history are added, this draft becomes incomplete.

## Security and user-control statements that are currently supportable

- Data in transit between the app and NearTime production services uses HTTPS.
- Current-location permission is optional; the user can choose another place/address.
- Android location permission can be revoked in system settings.
- NearTime currently has no user accounts.
- NearTime currently does not serve ads.

Official form guidance:
https://support.google.com/googleplay/android-developer/answer/10787469
