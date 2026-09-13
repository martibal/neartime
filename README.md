# NearTime

NearTime is a mobile-first place search and decision app built around one simple question:

> What do you need, and how much time are you willing to spend getting there?

The product is being developed for iOS and Android with a shared React Native / Expo / TypeScript codebase.

## Initial development goals

- Mobile UI first, using mock data before paid external API calls.
- Time-first search: category + maximum travel time + quality filters.
- One shared codebase for iOS and Android.
- Hard API cost controls before Google Places / Routes are enabled.
- GitHub as the source of truth; no local machine dependency for project state.

## First milestone

A runnable mobile prototype with:

- current-position entry point
- category selection
- 5 / 10 / 15 / 20 minute travel-time selection
- minimum rating filter
- open-now filter
- mock result list and map placeholder
- automated type-checking in CI

Real Google API calls are intentionally not enabled in the initial scaffold.
