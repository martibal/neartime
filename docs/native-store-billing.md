# NearTime native Google Play billing

Current Android monetization model:

- 5 free logical searches per anonymous installation.
- `neartime_monthly`: auto-renewing subscription, target Norwegian price 39 NOK/month, 30 searches per billing period.
- `neartime_search_pack_20`: consumable one-time product, target Norwegian price 19 NOK, 20 extra searches.
- Extra-search packs require an active/grace monthly subscription.
- Extra searches persist until used and are consumed only after the monthly allowance reaches zero.

The native Kotlin app uses Google Play Billing Library 9.1.0. Google Play remains the source of truth for checkout price and purchase state.

## Security boundary

The client cannot grant paid searches itself. Google Play purchase tokens are verified on NearTime's backend before an entitlement session or top-up is granted. The Supabase search gate authorizes quota before the Google Places provider call. Technical/provider failures release the reservation and do not consume a logical search.

Subscription purchases are acknowledged only after server verification. Search-pack purchases are consumed after server verification and idempotent credit, allowing the same product to be purchased again.

## Testing before Play products exist

A sideloaded debug build can test the five-search free allowance, live used/remaining counters, server blocking after the fifth successful search, and the paywall/restore UI. Actual checkout requires the Google Play products and a Play-distributed eligible test build/tester.
