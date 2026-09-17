# NearTime

NearTime is a mobile-first place search and decision app built around one simple question:

> What do you need, and how much time are you willing to spend getting there?

## Production search architecture

The native app uses current device location at search time, Google Maps SDK for the customer-visible global map, TomTom Orbis Places Search for current international place discovery, and TomTom hosted pedestrian Routing API for measured walking distance and time.

No local country map, OSM extract, Valhalla graph or desktop routing service is part of the production search path.

The product returns up to ten places ranked by measured pedestrian route distance. If the Top 10 cannot be proven inside the provider-cost ceiling, the request fails closed rather than returning a guessed ranking.

## Permanent economic invariant

A normal logical place search may never exceed NOK 0.30 in provider/API COGS. The production code uses a conservative no-free-tier cost model and caps provider calls before execution.

The normative contracts are docs/ECONOMIC_INVARIANTS.md and docs/COST_CONTRACT.md.

## Mobile

Android package: com.placefinder.app.

The native Android client calls the production HTTPS backend at https://neartime.vercel.app/api/native. No ADB reverse or local backend is required.
