# NearTime — Google Play release gate

Last reviewed: 2026-09-19.

This checklist is the release gate for the Android app. It separates requirements implemented in the repository from declarations/actions that must be completed in Google Play Console.

## Implemented in the repository

- [x] Android package is `com.placefinder.app`.
- [x] `targetSdk = 37`, above Google Play's API 36 minimum for new apps/updates from 2026-08-31.
- [x] HTTPS-only production network traffic.
- [x] Foreground location only; no background-location permission.
- [x] Current-location use is optional; a custom place/address can be used instead.
- [x] A concise location-use explanation is shown before the location-permission button.
- [x] Public privacy policy endpoint: `https://neartime.vercel.app/privacy`.
- [x] Public terms endpoint: `https://neartime.vercel.app/terms`.
- [x] Privacy Policy and Terms of Use are accessible from inside the app.
- [x] Google Maps attribution is displayed with Google Places results that are shown without a Google Map.
- [x] No account creation is currently offered, so Google Play's account-deletion requirement is not currently triggered.
- [x] No ads are currently served by NearTime.

## Play Console actions required before production submission

- [ ] Create/verify the Play Console developer account and ensure its public developer/support contact email is valid.
- [ ] Register the app with package name `com.placefinder.app`.
- [ ] Add `https://neartime.vercel.app/privacy` in **Policy > App content > Privacy policy**.
- [ ] Complete the **Data safety** form using `docs/PLAY_DATA_SAFETY_DRAFT.md` as the working draft, then re-check it against the exact release build and SDK inventory.
- [ ] Declare **Ads: No**, unless the released app changes.
- [ ] Complete **App access**. Current build has no login/restricted area, so reviewer access should be unrestricted.
- [ ] Complete **Target audience and content** truthfully. Do not select child age groups unless the released product is actually designed for them.
- [ ] Complete the IARC **Content rating** questionnaire.
- [ ] Complete any required sensitive-permission/location declaration shown by Play Console.
- [ ] Add store listing content: app name, short/full description, icon, feature graphic, screenshots, category, support contact and website/privacy URL.
- [ ] Configure Play App Signing and keep the upload key outside this repository.
- [ ] Generate and upload a signed Android App Bundle (`.aab`), not a debug APK.
- [ ] Run internal/closed testing and resolve Pre-launch report issues.
- [ ] If the developer account is a personal account created after 2023-11-13, satisfy Google's closed-test eligibility requirement before requesting production access.
- [ ] Complete Google Play developer verification/registration requirements that apply to the account by the applicable deadline.

## Location Button gate — Android 17 / API 37

NearTime targets API 37 and uses precise location for a one-time **search nearby** action. Google Play's Minimum Scope policy identifies this as a Location Button use case.

- Enforcement date currently stated by Google: **2027-01-27**.
- Before that policy becomes mandatory, replace the ordinary fine-location permission flow with AndroidX Location Button for the transactional current-location action, or document a valid exception if the product changes to a persistent precise-location use case.
- When implementing it, use `android:usesPermissionFlags="onlyForLocationButton"` for `ACCESS_FINE_LOCATION` and the official AndroidX Location Button library, following the then-current Android documentation.
- Re-check this gate immediately before every release after November 2026 because the Play Console declaration and policy wording may evolve.

## Re-run this review when any of these change

- a new SDK/provider is added;
- analytics, ads, accounts, payments, crash reporting or push notifications are enabled;
- NearTime starts retaining location/search history;
- background location or continuous navigation is introduced;
- Google/TomTom/Supabase architecture changes;
- the app starts targeting children; or
- a new Google Play policy deadline becomes effective.

Official references:

- Google Play User Data policy: https://support.google.com/googleplay/android-developer/answer/10144311
- Prepare app for review: https://support.google.com/googleplay/android-developer/answer/9859455
- Target API requirements: https://support.google.com/googleplay/android-developer/answer/11926878
- Minimum Scope / Location Button: https://support.google.com/googleplay/android-developer/answer/17033915
- Places API policies/attribution: https://developers.google.com/maps/documentation/places/web-service/policies
