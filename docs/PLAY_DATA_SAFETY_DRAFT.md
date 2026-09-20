# WayNear — Play Data Safety working draft

Last reviewed: 2026-09-19.

This is a submission worksheet, not a substitute for the Play Console form. Reconcile every answer against the exact release AAB, its dependency tree, the production backend and Google's current definitions immediately before submission.

## High-level form answers

Current expected answers:

- **Does the app collect or share required user data types?** Yes.
- **Is all user data encrypted in transit?** Yes, based on the current HTTPS-only app/backend/provider paths. Re-verify the release build.
- **Does the app let users create an account?** No.
- **Account deletion requirement triggered?** No, while WayNear has no account creation.
- **Contains ads?** No.

Do not answer "No data collected" merely because WayNear avoids storing raw location. Google treats data transmitted off-device as collection unless a specific exemption applies.

## Current architecture relevant to Data Safety

- Foreground Android location is optional.
- Current-location search can access foreground approximate or precise location supplied by Android. The app targets API 37; under Google's announced Minimum Scope policy, one-time precise-location use is in scope for the Android Location Button requirement from 27 January 2027, with the Play Console precise-location declaration expected from November 2026.
- The selected origin is sent over HTTPS to WayNear's Supabase Edge Function.
- The backend sends location/search parameters to Google Places API to obtain nearby place data and walking routing summaries.
- Custom place/address text is sent through the WayNear backend to TomTom Suggest/Details when the user explicitly uses that flow.
- A random app-install identifier is generated locally. A SHA-256 installation hash is sent to the search backend for anonymous quota/idempotency. The billing path can send the installation identifier to WayNear's billing backend.
- Search-cost/quota storage intentionally does not persist raw origin latitude/longitude, typed address text or returned place names.
- Operational search records can retain request IDs, timestamps, category, walking-time/open-now filters, result status/count, provider-call/cost metadata and build IDs.
- When Google Play Billing is used, the app receives a Google Play purchase token and sends it to WayNear's backend for server-side verification. The backend persists pseudonymous/HMAC-derived entitlement or purchase identifiers and product/subscription state; raw payment-card details are not accessed by WayNear.
- The native Android app **does include the Google Maps Android SDK** through `com.google.maps.android:maps-compose:6.12.0` for the user-initiated **Choose on map** start-point picker. Nearby place discovery/routing for normal search is still performed server-side, while "Open in Maps"/route actions use external Google Maps intents/URLs.
- The native app includes Google Play Billing Library 9.1.0; review Google's SDK/data guidance for the exact release version.

## Working data-type declaration

| Play data type | Collected? | Shared? | Ephemeral? | Optional / required | Purpose / release note |
| --- | --- | --- | --- | --- | --- |
| Approximate location | Yes, when Current location is used and Android supplies approximate location | Determine under current service-provider/user-initiated transfer rules before submission | Raw origin is intended not to be persisted by WayNear's application database | Optional | App functionality: nearby search and walking results |
| Precise location | Yes, when permission/use supplies precise location | Determine under current service-provider/user-initiated transfer rules before submission | Raw origin is intended not to be persisted by WayNear's application database | Optional | App functionality: more accurate nearby search |
| Other user-generated content: custom place/address text | Yes, only when the user uses Other place | Determine TomTom/service-provider classification before submission | Intended to be request-scoped in WayNear application storage | Optional | App functionality: resolve a user-selected origin |
| App interactions | Yes | Normally not intentionally disclosed beyond service providers | No; limited operational fields are retained | Required when a search is made | App functionality, reliability, abuse prevention and API-cost control |
| Device or other IDs: anonymous installation ID/hash | Yes | No intentional non-service-provider sharing | No | Required for the anonymous quota/search service | App functionality, fraud/abuse prevention, security and idempotency |
| Purchase history / transaction entitlement data | Yes, when the user purchases/restores | Google Play is the payment platform; classify any additional transfer using current definitions | No; verified entitlement/purchase state is retained as required to provide purchased access | Optional until the user purchases | App functionality, purchase verification, fraud prevention and subscription entitlement |

### Payment data distinction

WayNear does **not** access a user's payment-card number or bank credentials. Google Play collects payment credentials directly. Under Google's Data safety guidance, payment data collected directly by the payment service does not need to be declared by the app when the app never accesses it.

WayNear **does** receive purchase/entitlement information, including purchase tokens and verified product/subscription state. Therefore the final form must consider **Purchase history** separately from payment-card information.

## Sharing classification

Google defines sharing broadly as transferring collected app data to a third party, including server-to-server transfers. It also provides exceptions, including qualifying service providers processing data on the developer's behalf and certain user-initiated transfers.

Before submission, determine whether Supabase, Google Maps Platform / Places and TomTom each qualify for a sharing exception for the exact processing performed. Do not mark "not shared" merely because the transfer is necessary for functionality.

Regardless of the Data safety "shared" checkbox, the Privacy Policy should continue to disclose these providers and the fact that data is transmitted to them for the requested functionality.

## Retention facts that must remain true

- raw search-origin coordinates are not intentionally written to the WayNear application database;
- typed custom address/place queries are not intentionally written to the WayNear application database;
- returned place names are not intentionally written to the cost/quota ledger;
- anonymous quota/entitlement identifiers and operational records can be retained;
- purchase/subscription state can be retained for entitlement, accounting, fraud prevention and legal/operational needs.

If infrastructure logging is changed to record request bodies, location/address retention must be reclassified immediately.

## Data deletion

WayNear currently has no user account. Google's account-deletion requirement therefore does not apply to the current architecture.

The Data safety form separately asks about data-deletion mechanisms. Do not claim a deletion feature that does not exist. If a deletion-request mechanism is later added, document exactly which WayNear-held records it covers and any legitimate retention exceptions.

## SDK/provider inventory gate

Before uploading the release AAB, run a final dependency/manifest inventory and confirm at minimum:

- no advertising SDK;
- no analytics SDK unless intentionally added and declared;
- no crash-reporting SDK unless intentionally added and declared;
- Google Play Billing Library version and its data behavior;
- no unexpected device-ID collectors;
- Google Maps Android SDK/API-key configuration is present only for the explicit map start-point picker and is restricted appropriately;
- no background-location permission;
- no push-notification SDK unless intentionally added and declared.

If crash reporting, analytics, advertising, login/accounts, push notifications, persistent search history or new SDKs/providers are added, this draft becomes incomplete.

## Security and user-control statements currently supportable

- App/backend network communication uses HTTPS.
- Current-location permission is optional; Other place can be used instead.
- Android location permission can be revoked in system settings.
- WayNear currently has no user accounts.
- WayNear currently serves no ads.
- Search/purchase authorization is pseudonymous and does not require a WayNear name, email address or password.

Official form guidance:

https://support.google.com/googleplay/android-developer/answer/10787469
