# WayNear native Google Play billing

Current Android monetization model:

- Production intent: 5 free completed logical searches per anonymous Android device/user/app-signing identity.
- A completed search consumes one logical search regardless of whether it returns 0, 5 or 10 qualifying places.
- A technical/provider failure that does not complete normally does not consume the logical search under the current quota policy.
- `neartime_monthly`: auto-renewing subscription, target Norwegian price 39 NOK/month, 30 searches per billing period.
- `neartime_search_pack_20`: consumable one-time product, target Norwegian price 19 NOK, 20 extra searches.
- Extra-search packs require an active/grace monthly subscription.
- Extra searches persist until used and are consumed only after the monthly allowance reaches zero.

The native Kotlin app uses Google Play Billing Library 9.1.0. Google Play remains the source of truth for localized checkout price and purchase state.

## Current test mode

The production five-search gate is **not enabled yet**. The backend trial policy is deliberately set to a very high test allowance while development continues.

The Android UI exposes a temporary test observer:

`X of 5 used`

This display reads the real anonymous `trial_used` counter so development can verify the intended production semantics:

- 0-result completed search -> +1;
- 5-result completed search -> +1;
- 10-result completed search -> +1;
- technical/provider failure -> no increment under the current policy.

The visible "of 5" number is diagnostic only during test mode and does not currently block the sixth search.

Before production, restore the backend trial limit to 5 and verify that the same counter shown to the user is the single gate that blocks further free searches.

## Security boundary

Free-trial quota is keyed server-side by a SHA-256 hash derived from Android's app-scoped `ANDROID_ID`, rather than by the random installation ID. On supported Android versions this survives an ordinary uninstall/reinstall for the same device user and app-signing key, so reinstalling the app does not grant another five free searches. A factory reset, different Android user/profile, different device, or different signing identity can produce a different identifier; WayNear deliberately does not use invasive device fingerprinting to close those cases.

The client cannot grant paid searches itself. Google Play purchase tokens are sent to WayNear's backend and verified with Google before an entitlement session or top-up is granted. The backend persists pseudonymous/HMAC-derived purchase/entitlement identifiers rather than using a WayNear email/login identity.

The Supabase search gate authorizes quota before the Google Places provider call.

Subscription purchases are acknowledged only after server verification. Search-pack purchases are consumed after server verification and idempotent credit, allowing the same product to be purchased again.

## Google Play subscription-policy release gates

Before the subscription is enabled for production:

- show the localized Google Play price;
- clearly state the billing period/frequency;
- clearly state that the subscription auto-renews until cancelled;
- clearly state the recurring benefit/quota;
- make clear that free functionality exists if it remains available;
- provide an easy-to-use in-app link to Google Play's subscription-management/cancellation page;
- ensure store listing, Play product configuration and in-app copy describe the same offer.

The current app has Restore purchases but does not yet have the required Manage subscription/cancellation link. That is a release blocker for paid subscription launch.

## Play testing

Actual checkout requires Google Play products and a Play-distributed eligible test build/tester. Sideloaded builds are sufficient for search/quota UI testing but are not the final proof of Play Billing behavior.

Required Play-distributed billing tests:

- subscription purchase;
- pending purchase;
- server verification before entitlement;
- acknowledgement;
- restore;
- cancellation;
- grace/hold if configured;
- expiry;
- refund/revocation handling;
- consumable top-up verification and consumption.
