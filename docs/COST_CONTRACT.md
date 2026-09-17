# NearTime production search contract

Effective architecture: 2026-09-18-global-cloud-walk-v1.

These are release-blocking requirements.

## Customer-visible map and GPS

- The Android app renders Google Maps SDK live map content.
- A search using My location requests a current device location at search time; it does not prefer a minutes-old cached position.
- No country map, OSM extract, routing graph, Valhalla instance, Docker container or other local geographic dataset participates in production search.

## International place discovery and walking measurement

- POI discovery is a live request to TomTom Places Search API on TomTom Orbis Maps.
- Up to 100 current POI candidates are requested around the current coordinates.
- Every candidate used for ranking is measured with TomTom hosted Routing API using pedestrian mode.
- Results are sorted by measured pedestrian route distance in metres, then travel time as a tie-breaker.
- At most ten places are returned.

NearTime never labels a straight-line estimate as walking distance.

## Top-10 proof

Candidates are processed in ascending straight-line distance. Walking distance can never be shorter than straight-line distance.

After cloud pedestrian routes have been measured, the Top 10 is accepted only when either all relevant discovered candidates have been resolved, or the measured walking distance of the current tenth place is no greater than the lower bound of every unresolved candidate.

Failed route calls and unknown open-now state remain blockers. They are never silently treated as non-qualifying.

If the proof is not established before the hard cost limit is reached, the search returns DEGRADED with no potentially incorrect Top 10.

## NOK 0.30 hard provider-cost ceiling

The normal production search path permits at most one Places Discover call and at most 24 pedestrian Calculate Route calls. There is no paid retry path.

The in-code guard deliberately uses conservative assumptions and does not deduct provider free allowances:

- Places Discover guard: EUR 5.00 / 1,000;
- Routing guard: EUR 0.75 / 1,000;
- FX stress: NOK 13.00 / EUR.

Worst case: ((5.00 + 24 x 0.75) / 1000) x 13.00 = NOK 0.299.

The code refuses to make another paid provider call when the next call would cross NOK 0.30 under this stress model. Provider pricing must be revalidated before release whenever the provider changes its schedule.

## Freshness and international operation

Place discovery uses TomTom Orbis Places Search, an online global service. Pedestrian routes are calculated online for each search by TomTom's hosted routing service. There is no periodically downloaded country file that can become stale on the device or NearTime server.

The visible map remains Google Maps SDK, so map rendering is also not tied to NearTime-hosted geographic data.
