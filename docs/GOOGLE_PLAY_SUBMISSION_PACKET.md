# NearTime — Google Play submission packet

Last reviewed against Google Play documentation: 2026-09-19.

This file is the authoritative worksheet for Google Play submission. It records every Play Console declaration or supporting document that NearTime is expected to need. It is not itself uploaded to Google Play. The final Play Console answers must be checked against the exact release AAB and current policy wording immediately before submission.

## 1. Release identity

Current repository state:

- Android application ID: `com.placefinder.app`
- Android namespace: `com.placefinder.app`
- current display name in the manifest: `NearTime`
- `strings.xml` still contains the old value `PlaceFinder`
- the product name is not yet final

### Release gate

Do not create the permanent Play app record until the final product name and permanent package/application ID have been chosen. A display name can be changed later, but the package/application ID should be treated as permanent once the Play app is registered.

Before first upload:

- [ ] final app name chosen;
- [ ] manifest label and `strings.xml` use the same final name;
- [ ] final application ID/package chosen and used consistently in Android, backend Google Play verification configuration and documentation;
- [ ] Privacy Policy and Terms refer to the final app name;
- [ ] Google Play developer name chosen.

## 2. Developer account / organization verification

Planned account type: Organization.

Play Console / Android developer verification requires organization information including legal name/address, D-U-N-S, verified contact details, developer contact details and a linked Google Payments profile. Organization accounts must also verify ownership of the organization website through Google Search Console.

Before closed testing:

- [ ] Organization developer account created and verified.
- [ ] D-U-N-S matches the legal ENK details.
- [ ] Organization website is controlled by the developer and verified in Search Console.
- [ ] Contact email verified.
- [ ] Contact phone verified.
- [ ] Public developer email verified.
- [ ] Public developer phone verified.
- [ ] Google Payments profile linked and verified.
- [ ] Legal/public information in Play Console matches the organization records.

Do not place private credentials, D-U-N-S numbers, personal addresses, payment data or verification documents in this repository.

## 3. Privacy Policy

Google Play requires a comprehensive privacy policy that is:

- available at an active public URL;
- non-editable by visitors;
- linked in Play Console;
- accessible from inside the app;
- clearly associated with the released app/developer;
- consistent with the Data safety declaration;
- accurate about access, collection, use and sharing of user/device data.

Repository source:

- `legal/privacy.html`
- public route intended as `https://neartime.vercel.app/privacy`

Current covered processing:

- optional foreground approximate/precise location;
- custom place/address text;
- search/filter inputs and operational telemetry;
- anonymous installation identifier / installation hash for quota, abuse and idempotency;
- Google Play subscription / one-time purchase state and purchase tokens when billing is used;
- Supabase, Google Maps Platform / Places and TomTom service-provider processing;
- HTTPS transport;
- no advertising;
- no NearTime user account.

### Release gate

- [ ] Replace the generic contact paragraph with the actual verified developer/privacy email before submission.
- [ ] Replace NearTime with the final app name if renamed.
- [ ] Confirm public privacy URL loads without authentication and without errors.
- [ ] Confirm the policy exactly matches the final SDK/provider inventory.

## 4. Data safety declaration

NearTime must answer **Yes** to the high-level question asking whether the app collects or shares required user data types, because data leaves the device for core functionality.

Working declaration source:

- `docs/PLAY_DATA_SAFETY_DRAFT.md`

Final declaration must be reconciled against the release AAB.

Expected categories currently in scope:

- Approximate location
- Precise location
- Other user-generated content (custom location/place text)
- App interactions
- Device or other IDs (anonymous installation identifier / hash)
- Purchase history when Google Play Billing is enabled

NearTime does not access card numbers or other payment credentials; Google Play collects those directly. Do not declare payment-card data merely because Google Play Billing is used.

Transfers to Supabase/Google/TomTom must be classified using the current Play Data safety definitions. A service-provider transfer may be exempt from the "shared" label, but only if the actual contractual/processing role qualifies under Google's definition. Do not infer this solely from the vendor name.

## 5. Account deletion / data deletion

Current app behavior:

- no NearTime account creation;
- no user login;
- subscription entitlement is pseudonymous and derived from Google Play;
- anonymous installation/quota state exists.

Therefore Google's **account deletion** requirement is not currently triggered.

The Data safety form still contains data-deletion questions. Answer them truthfully based on the release behavior. Do not claim an account-deletion feature that does not exist.

Release rule:

- if NearTime later adds account creation, it must add both an in-app deletion path and a public web deletion-request resource before release.

## 6. App access declaration

Current app has no sign-in or account gate.

Recommended Play Console reviewer instruction:

> No sign-in is required. The app can be used with Current location after granting foreground location permission, or with Other place without granting location permission. The app includes a free search allowance. Paid entitlement, when enabled, uses Google Play Billing.

Before submission, confirm that Google reviewers can reach all material functionality. If any feature is restricted by a paid entitlement, special location state, test account, membership or other gate, provide exact review instructions in **Policy > App content > App access**.

## 7. Ads declaration

Current answer:

- **Contains ads: No**

If any advertising SDK or ad placement is later added, this declaration, Privacy Policy and Data safety form must all be revisited before release.

## 8. Target audience and content

NearTime is a general-purpose place-search utility and is not designed as a child-directed app.

Before submission:

- [ ] select only the age groups the product actually targets;
- [ ] do not include child age groups merely to broaden distribution;
- [ ] if any child age group is selected, complete the Families-policy review before publishing.

No current feature requires a child-directed classification.

## 9. IARC content rating

All Play apps require an IARC content rating.

Current product facts relevant to the questionnaire:

- place-search utility;
- no user-to-user communication;
- no user-generated review text currently displayed;
- no gambling;
- no violence/sexual content generated by NearTime;
- no ads.

The final questionnaire must be completed in Play Console and repeated if material app content changes.

## 10. Financial features declaration

Google requires the Financial features declaration for apps on closed, open or production tracks, including apps that have no financial features.

Current intended answer:

- **My app doesn't provide any financial features.**

Google Play Billing for the app's own digital subscription/search packs is commerce for app functionality; it does not make NearTime a banking, wallet, lending, trading or other financial-services app.

## 11. Health apps declaration

Google requires the Health apps declaration for published/test-track apps, even if they have no health functionality.

Current intended answer:

- **No health features.**

## 12. News and Magazine declaration

NearTime is not a News or Magazine app and should not be listed in that category or described as such. Complete any Play Console applicability question consistently with that fact.

## 13. Location permission / Minimum Scope

Current manifest requests:

- `ACCESS_COARSE_LOCATION`
- `ACCESS_FINE_LOCATION`
- no background location

Current use is foreground and transactional: one-time "search nearby".

The app targets API 37. Google's announced Minimum Scope policy requires the Android Location Button for transactional precise-location use cases for apps targeting Android 17 / API 37+, with enforcement stated for 2027-01-27 and the precise-location declaration expected in Play Console from November 2026.

Current status:

- ordinary runtime fine/coarse permission flow is still used;
- Location Button is not yet implemented.

Release implications:

- a 2026 closed test can proceed under the currently announced enforcement timeline;
- this is a hard release gate for any release subject to the 2027-01-27 enforcement date;
- before that deadline, implement the official Location Button flow or change the product so precise persistent foreground access is genuinely required and can be justified.

Do not request background location unless the product fundamentally changes and passes a new policy review.

## 14. Google Play Billing / subscriptions

Current products in code:

- `neartime_monthly` — auto-renewing subscription;
- `neartime_search_pack_20` — consumable one-time product.

Google Play Billing Library version in the native project: 9.1.0.

Required policy behavior before monetized production release:

- Google Play Billing must be used for these digital purchases;
- subscription offer UI must clearly show the localized price, billing frequency, auto-renewal and material benefits/limits;
- if free functionality remains available, the UI must make that clear;
- the app must contain an easy-to-use online method to manage/cancel the subscription, normally a link to the Google Play Subscription Center;
- server verification must occur before entitlement is granted;
- subscription purchases must be acknowledged after verification;
- consumable search packs must only be consumed after successful server verification/credit.

Current hard blocker:

- [ ] Add a visible **Manage subscription** / cancellation link before enabling the subscription for production.

The Play Store product configuration and in-app text must agree. Do not hard-code a price as authoritative; display the localized price returned by Google Play.

## 15. Store listing / metadata

Before publishing a store listing:

- [ ] final app title;
- [ ] short description;
- [ ] full description;
- [ ] app category;
- [ ] 512 x 512 Play Store icon;
- [ ] 1024 x 500 feature graphic;
- [ ] at least two compliant screenshots;
- [ ] support/developer contact details;
- [ ] website;
- [ ] privacy-policy URL.

Store listing claims and screenshots must match actual released functionality. Do not claim global/exhaustive search coverage that the backend cannot prove.

## 16. Release artifact / signing

Before any external Play test:

- [ ] Play App Signing configured;
- [ ] upload key generated and stored outside the repository;
- [ ] release signing configured;
- [ ] signed Android App Bundle (`.aab`) generated;
- [ ] release build contains no debug-only secrets or endpoints;
- [ ] server API keys remain server-side;
- [ ] package/application ID matches Play Console;
- [ ] target API requirement satisfied;
- [ ] Pre-launch report reviewed.

Current `targetSdk = 37`, which is above the API 36 minimum for new apps/updates effective 2026-08-31.

## 17. Testing track

For an Organization developer account, the special 12-testers-for-14-days rule for newly created Personal accounts is not the relevant gate. NearTime should still use Play tracks in this order:

1. Internal testing for the developer's own Play-distributed release verification.
2. Closed testing for external testers.
3. Production after policy/release gates are complete.

Before closed testing, complete all Play Console declarations that Play marks as required for the track, including the Financial features and Health apps declarations.

## 18. Repository consistency issues found during audit

These are not all Google-policy violations by themselves, but they must be resolved before release because they can make declarations inaccurate.

- `strings.xml` still says `PlaceFinder` while the manifest says `NearTime`.
- Product name is not final.
- `.env.example` contains the historical Google Play package `com.martibal.neartime`, while the active native app is currently `com.placefinder.app`.
- The native manifest still contains a Google Maps Android API-key meta-data entry even though the current native dependency list does not include the Google Maps SDK; confirm whether it is still needed and remove it if unused.
- Several old architecture/COGS documents describe superseded provider paths. They are engineering history and must not be used as Play Console declaration sources.
- `docs/purchase-funnel-events.md` contained the retired 3-success/5-attempt trial model; this audit updates it to the current one-counter model.
- The subscription UI does not yet contain a Google Play subscription-management/cancellation link.
- The final privacy contact email cannot be completed until the developer account/contact address is chosen.

## 19. Authoritative repository files for Play submission

Use these files for submission work:

1. `docs/GOOGLE_PLAY_SUBMISSION_PACKET.md` — master Play submission worksheet.
2. `docs/PLAY_STORE_RELEASE_CHECKLIST.md` — executable release gate.
3. `docs/PLAY_DATA_SAFETY_DRAFT.md` — Data safety answers.
4. `legal/privacy.html` — public Privacy Policy.
5. `legal/terms.html` — public Terms of Use.
6. `docs/native-store-billing.md` — billing/subscription implementation contract.

Do **not** derive Play declarations from archived COGS experiments or the old Expo prototype.

## Official references

- User Data / Privacy Policy: https://support.google.com/googleplay/android-developer/answer/10144311
- Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Prepare app for review / App content: https://support.google.com/googleplay/android-developer/answer/9859455
- Play Console requirements: https://support.google.com/googleplay/android-developer/answer/10788890
- Target audience: https://support.google.com/googleplay/android-developer/answer/9867159
- Content ratings: https://support.google.com/googleplay/android-developer/answer/9898843
- Financial features declaration: https://support.google.com/googleplay/android-developer/answer/13849271
- Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291
- Minimum Scope / Location Button: https://support.google.com/googleplay/android-developer/answer/17033915
- Subscriptions policy: https://support.google.com/googleplay/android-developer/answer/9900533
- Payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Store listing assets: https://support.google.com/googleplay/android-developer/answer/9866151
- Developer identity verification: https://support.google.com/googleplay/android-developer/answer/10841920
