# NearTime

NearTime is a mobile-first place search and decision app built around one simple question:

> What do you need, and how much time are you willing to spend getting there?

The product is being developed for iOS and Android with a shared React Native / Expo / TypeScript codebase.

## Permanent economic invariants

These requirements override implementation convenience. They may not be relaxed to make a search feature work.

1. **A customer may never cost NearTime more in provider/API costs than the net revenue allocated to that customer for the same billing period.** This must be enforced before provider calls are made through conservative worst-case reservation and fail-closed admission.
2. **One logical customer search must never cost more than NOK 10 in provider COGS.** NOK 10 is an absolute ceiling, not an average target. If a search cannot be proven complete within that ceiling, it must fail closed rather than continue spending.
3. **Coverage and economics are simultaneous hard constraints.** NearTime may neither return an incomplete/truncated result as complete to save money nor exceed the economic ceiling to preserve completeness.

The normative contract is in [`docs/ECONOMIC_INVARIANTS.md`](docs/ECONOMIC_INVARIANTS.md). Any production path capable of billable provider traffic must satisfy it before release.

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
