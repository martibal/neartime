# NearTime native store billing

NearTime uses `expo-iap` for App Store / Google Play checkout inside the custom Expo development client and production builds.

## Product mapping

- `neartime_trip_3d`: one-time in-app purchase (consumable), 29 NOK, 5 logical searches, 3-day activation window.
- `neartime_monthly`: subscription, 39 NOK, 9 logical searches per billing period.
- `neartime_trip_7d`: one-time in-app purchase (consumable), 49 NOK, 11 logical searches, 7-day activation window.

Store product IDs must match these canonical IDs exactly on both platforms.

## Security boundary

The client may open native checkout and receive a store purchase object, but it cannot grant access. The purchase is sent to NearTime's backend for verification. Only a server-issued opaque entitlement session unlocks paid search.

Transactions are finished only after successful backend verification. Trip Pass transactions remain unfinished until the dedicated one-time purchase verifier is implemented, preventing client-only activation.

## Expo build requirements

`expo-iap` is a native module and therefore requires a custom development build; it is not available in Expo Go. The Expo SDK 57 / React Native 0.86 stack is the validated OpenIAP baseline. Native builds must be regenerated after this dependency/config-plugin change.

No Google Places live probe is required to validate the billing integration itself.
