# WayNear

WayNear is a mobile-first place search and decision app built around one simple question:

> What do you need, and how much time are you willing to spend getting there?

## Production search architecture

The native Android app uses a current or user-selected origin. Normal place searches are sent over HTTPS to the production Supabase Edge Function. The current production search path uses Google Places Nearby Search with Google walking routing summaries, returns up to ten qualifying places, and ranks them by measured walking distance/time.

TomTom is currently used for the optional **Type a location** suggestion/details flow. Android's platform geocoder is used only to turn the device's current coordinates into a human-readable location label. The native app also includes the Google Maps Android SDK (via Maps Compose) for the user-initiated **Choose on map** start-point picker.

No ADB reverse, local Node backend, downloaded country map, OSM extract, Valhalla graph, Docker routing service or desktop process is required by the released mobile search path.

## Cost controls

Provider usage is bounded by server-side search rules and monitored through the WayNear Cost Monitor. Production code must remain fail-closed when a requested provider path would violate the active cost contract.

The normative cost documents are `docs/ECONOMIC_INVARIANTS.md` and `docs/COST_CONTRACT.md`.

## Android

Package: `com.placefinder.app`.

Current native Android source:
`android-native/app/src/main/java/com/placefinder/app/MainActivity.kt`

Production search endpoint:
`https://pcckllkvnootomwxsmlu.supabase.co/functions/v1/native-search`

## Google Play / legal

Public privacy policy:
https://neartime.vercel.app/privacy

Public terms:
https://neartime.vercel.app/terms

Release checklist:
`docs/PLAY_STORE_RELEASE_CHECKLIST.md`

Data Safety working draft:
`docs/PLAY_DATA_SAFETY_DRAFT.md`

Google Play submission packet:
`docs/GOOGLE_PLAY_SUBMISSION_PACKET.md`
