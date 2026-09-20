# WayNear — Google Play release gate

Last reviewed: 2026-09-20.

This checklist is the executable release gate for the native Android app. The full declaration worksheet is `docs/GOOGLE_PLAY_SUBMISSION_PACKET.md`.

## Before creating the permanent Play app record

- [ ] Final app/product name chosen.
- [ ] Final Android application ID/package chosen.
- [ ] Manifest label, `strings.xml`, backend Play configuration and documentation use the same identity.
- [ ] Remove/replace historical package references such as `com.martibal.neartime` if they do not match the final package.
- [ ] Confirm the launcher icon and Play Store branding use the final product identity.

## Implemented in the repository

- [x] Current native package is `com.placefinder.app` (pre-release; not yet treated as permanent).
- [x] `targetSdk = 37`, above Google Play's API 36 minimum for new apps/updates from 2026-08-31.
- [x] HTTPS-only production network traffic.
- [x] Foreground location only; no background-location permission.
- [x] Current-location use is optional; a custom place/address can be used instead.
- [x] Location-use explanation is shown in the location flow.
- [x] Public privacy-policy source and route exist: `legal/privacy.html` -> `/privacy`.
- [x] Public terms source and route exist: `legal/terms.html` -> `/terms`.
- [x] Privacy Policy and Terms of Use are accessible from inside the app.
- [x] Google attribution is displayed with provider results.
- [x] No WayNear account creation is offered, so Google's account-deletion requirement is not currently triggered.
- [x] No ads are currently served.
- [x] Google Play Billing is integrated client-side and purchase tokens are verified server-side before entitlement.
- [x] Data Safety working draft includes location, custom-origin text, app interactions, install identifiers and purchase history.

## Repository/documentation blockers before Play submission

- [x] `strings.xml` and manifest display label are aligned to `WayNear`.
- [x] `.env.example` Google Play package is aligned to `com.placefinder.app`.
- [x] Google Maps Android SDK/API-key configuration is required by the `Choose on map` start-point picker; keep it and restrict the production key to the Android app/package/signing certificate.
- [ ] Put the actual verified developer/privacy email in the public Privacy Policy.
- [ ] If the app is renamed, update Privacy Policy, Terms and all Play metadata.
- [ ] Add an in-app **Manage subscription** / cancellation link before paid subscription launch.
- [ ] Ensure the subscription offer UI clearly shows localized price, billing frequency, auto-renewal, benefit/quota and availability of free functionality.
- [ ] Implement Android Location Button and `android:onlyForLocationButton="true"` before any release subject to the 2027-01-27 enforcement deadline. Because WayNear targets API 37 and uses precise location for a one-time nearby-search action, treat this as a pre-production policy gate rather than postponing it.

## Organization developer-account setup

- [ ] Create/verify the Organization developer account.
- [ ] D-U-N-S and legal organization details match.
- [ ] Link/verify Google Payments profile.
- [ ] Verify contact email and phone.
- [ ] Verify public developer email and phone.
- [ ] Verify organization website ownership through Google Search Console.
- [ ] Keep all verification information operational for the lifetime of the developer account.

## Play Console App content declarations

- [ ] Privacy policy: add the final public `/privacy` URL.
- [ ] Data safety: complete from `docs/PLAY_DATA_SAFETY_DRAFT.md`, then reconcile against the release AAB.
- [ ] Ads: declare **No** unless release behavior changes.
- [ ] App access: state no sign-in is required and give reviewer instructions for Current location / Other place and any paid-entitlement limitations.
- [ ] Target audience and content: choose the actual target age groups; WayNear is not child-directed.
- [ ] IARC Content rating questionnaire completed.
- [ ] Financial features declaration completed: current intended answer is **no financial features**.
- [ ] Health apps declaration completed: current intended answer is **no health features**.
- [ ] Government apps declaration completed: WayNear is **not a government app** and does not present itself as an official government source.
- [ ] COVID-19 contact tracing/status declaration completed: **No**.
- [ ] News/Magazine applicability answered consistently: WayNear is not a News/Magazine app.
- [ ] Advertising ID declaration, if surfaced: confirm from the final merged manifest; current app does not intentionally use Advertising ID.
- [ ] Complete the precise-location declaration when Play Console makes it available (announced for November 2026) if `ACCESS_FINE_LOCATION` remains in the release.

## Privacy / user data

- [ ] Public Privacy Policy URL loads without login, redirects or errors.
- [ ] Privacy Policy names the released app/developer and contains an actual privacy contact mechanism.
- [ ] Privacy Policy and Data safety answers are consistent.
- [ ] Verify no release SDK collects data omitted from Data safety.
- [ ] Verify no request-body logging persists coordinates/custom address text.
- [ ] Verify location remains optional.
- [ ] Verify no background location permission.
- [ ] Verify the final merged manifest does not unexpectedly contain `com.google.android.gms.permission.AD_ID`.
- [ ] If user accounts are ever added, add in-app account deletion and a public deletion-request resource before release.

## Billing / monetization

- [ ] Create `neartime_monthly` in Play Console with the final base plan/price.
- [ ] Create `neartime_search_pack_20` as a one-time in-app product if retained.
- [ ] Confirm the subscription provides sustained recurring value and the quota/benefit matches the store/in-app description.
- [ ] Confirm localized price comes from Google Play Billing rather than a hard-coded authoritative value.
- [ ] Add easy online subscription cancellation/management access in-app.
- [ ] Verify purchase, pending purchase, restore, cancellation, expiry, grace and refund/revocation behavior on a Play-distributed test build.
- [ ] Configure Google Play Developer API / RTDN credentials if the production entitlement path requires them.
- [ ] Confirm the final package name in Google Play Developer API configuration.

## Store listing

- [ ] App title.
- [ ] Short description.
- [ ] Full description.
- [ ] App category.
- [ ] 512 x 512 Play Store icon.
- [ ] 1024 x 500 feature graphic.
- [ ] At least two compliant screenshots.
- [ ] Support/developer contact details.
- [ ] Organization website.
- [ ] Privacy-policy URL.
- [ ] Listing wording/screenshots accurately reflect release functionality and do not overclaim result exhaustiveness.

## Release/signing

- [ ] Configure Play App Signing.
- [ ] Generate and protect the upload key outside the repository.
- [ ] Configure a release signing build.
- [ ] Generate a signed Android App Bundle (`.aab`), not a debug APK.
- [ ] Confirm release AAB contains no debug endpoints/secrets.
- [ ] Confirm server API keys remain server-side.
- [ ] Confirm release versionCode/versionName are intentional.
- [ ] Review Play Pre-launch report.
- [ ] Resolve all policy/review warnings before promoting the release.

## Testing order

- [ ] Internal testing: install the Play-signed/distributed build and verify location, custom origin, search, billing connection and legal links.
- [ ] Closed testing: recruit external testers and verify real-device behavior.
- [ ] Production only after all gates above are closed.

The special 12-testers-for-14-days production-access rule applies to qualifying new **Personal** developer accounts. If WayNear is registered under the planned Organization account, do not treat that Personal-account rule as the governing release gate.

## Location Button gate — Android 17 / API 37

WayNear targets API 37 and uses precise location for a one-time **search nearby** action. Google's Minimum Scope policy identifies this as a Location Button use case.

- Google states the precise-location declaration will be available from November 2026.
- Enforcement is currently stated for **2027-01-27**.
- Before enforcement, implement the official Android Location Button for the transactional precise-location action if the app remains API 37+.
- Re-check the policy immediately before every release because implementation details/deadlines can change.

## Re-run this review when any of these change

- app name or package/application ID;
- a new SDK/provider is added;
- analytics, ads, accounts, crash reporting or push notifications are enabled;
- billing products/benefits change;
- WayNear starts retaining location/search history;
- background location or continuous navigation is introduced;
- Google/TomTom/Supabase architecture changes;
- the app starts targeting children;
- Google Play policy deadlines change.

Official references:

- Google Play User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Prepare app for review: https://support.google.com/googleplay/android-developer/answer/9859455
- Play Console requirements: https://support.google.com/googleplay/android-developer/answer/10788890
- Target API requirements: https://support.google.com/googleplay/android-developer/answer/11926878
- Minimum Scope / Location Button: https://support.google.com/googleplay/android-developer/answer/17033915
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291
- Government apps: https://support.google.com/googleplay/android-developer/answer/9514050
- Subscriptions: https://support.google.com/googleplay/android-developer/answer/9900533
- Store listing assets: https://support.google.com/googleplay/android-developer/answer/9866151
