# NearTime search cost contract

Effective architecture: 2026-09-18-discover-valhalla-v1.

This document is a build constraint, not a future optimisation target.

## Normal explicit place search

A normal search from the Android app is allowed to perform:

- exactly 0 Google Places requests;
- at most 1 TomTom Places Search Discover request;
- exactly 0 paid pedestrian-routing requests;
- at most 1 request to the self-hosted Valhalla sources_to_targets endpoint.

GPS refresh, map movement, filter changes and category selection must perform zero paid provider requests.

Custom start-location search is separate from the normal place-search cost contract. TomTom Suggest and Details may run only after explicit user interaction.

## Why routing is local

NearTime needs real pedestrian travel time for every candidate before it can enforce the user's walking-time limit and sort the result set. Issuing one paid route request per candidate makes marginal cost scale with candidate count. The production architecture therefore computes the one-to-many pedestrian matrix on NearTime's own Valhalla instance.

## Regression gate

backend-node/server.test.mjs must fail if the normal search path contains either:

- Google Places service calls; or
- TomTom Routing API calls.

The test suite also requires both the TomTom Discover endpoint and the local Valhalla matrix endpoint to remain present.

A provider or architecture change that increases the number of paid calls per normal search must not be merged until its paid-unit economics have been recalculated explicitly.
