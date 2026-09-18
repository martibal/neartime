'use strict';

/**
 * NearTime native cloud search.
 *
 * One explicit normal search:
 * - current device coordinates arrive from the app
 * - max 1 TomTom Orbis Places Discover call
 * - max 24 TomTom hosted pedestrian route calls
 * - no local routing graph, country download, Docker or Valhalla
 * - conservative hard provider COGS ceiling: NOK 0.30
 * - result order: measured pedestrian route distance
 * - fail closed when the Top 10 cannot be proven inside the cost ceiling
 */

const crypto = require('crypto');

const BUILD_ID = '2026-09-18-search-area-v13';
const RESULT_LIMIT = 10;
const DISCOVER_LIMIT = 100;
const MAX_ROUTE_CALLS = 24;
const ROUTE_BATCH_SIZE = 1;
const SEARCH_COST_CAP_NOK = 0.30;

const COST_GUARD = Object.freeze({
  discoverEurPer1000: 5.00,
  routeEurPer1000: 0.75,
  nokPerEur: 13.00,
});

const WORST_CASE_SEARCH_COST_NOK =
  ((COST_GUARD.discoverEurPer1000 +
    MAX_ROUTE_CALLS * COST_GUARD.routeEurPer1000) / 1000) *
  COST_GUARD.nokPerEur;

if (WORST_CASE_SEARCH_COST_NOK > SEARCH_COST_CAP_NOK) {
  throw new Error('SEARCH_COST_CONTRACT_BROKEN');
}

const CATEGORY_QUERY = Object.freeze({
  cafes_coffee: 'cafe',
  restaurants: 'restaurant',
  fast_food_takeaway: 'fast food',
  bars_drinks: 'bar',
  bakeries_sweets: 'bakery',
  groceries_supermarkets: 'supermarket',
  clothing_fashion: 'clothing store',
  electronics: 'electronics store',
  home_furniture: 'furniture store',
  shopping_centres: 'shopping centre',
  other_shops: 'retail store',
  pharmacy: 'pharmacy',
  doctor_clinic: 'medical clinic',
  dentist: 'dentist',
  hospital: 'hospital',
  spa_wellness: 'spa wellness',
  gym_fitness: 'fitness center',
  swimming: 'public swimming pool',
  sports_facilities: 'sports center',
  golf: 'golf',
  parking: 'parking',
  public_transport: 'public transport station',
  train_stations: 'train station',
  bus_stations_stops: 'bus stop',
  fuel_stations: 'fuel station',
  ev_charging: 'EV charging',
  airports: 'airport',
  schools: 'school',
  preschool: 'preschool kindergarten',
  universities: 'university',
  libraries: 'library',
  parks: 'park',
  outdoor_activities: 'outdoor recreation',
  museums_galleries: 'museum art gallery',
  cinema: 'cinema',
  entertainment: 'entertainment venue',
  attractions: 'tourist attraction',
  playgrounds: 'playground',
  hotels: 'hotel',
  hostels_guest_houses: 'hostel guest house',
  camping: 'camping',
  hair_beauty: 'hair beauty salon',
  laundry: 'laundry',
  banks: 'bank',
  atm: 'ATM',
  post_office: 'post office',
  shipping_courier: 'shipping courier service',
  car_repair_tyres: 'car repair',
  car_wash: 'car wash',
  veterinary: 'veterinary clinic',
  pet_care: 'pet care service',
  pet_stores: 'pet supply store',
});

const DETAILS_TYPE_MAP = Object.freeze({
  poi: 'pois',
  address: 'addresses',
  street: 'streets',
  intersection: 'intersections',
  area: 'areas',
});

function send(res, status, body) {
  res.status(status).json(body);
}

function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requireTomTomKey() {
  const key = clean(process.env.TOMTOM_API_KEY);
  if (!key) {
    const error = new Error('TOMTOM_API_KEY_NOT_CONFIGURED');
    error.status = 503;
    throw error;
  }
  return key;
}

function validateOrigin(latitude, longitude) {
  const lat = num(latitude);
  const lon = num(longitude);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    const error = new Error('INVALID_LOCATION');
    error.status = 400;
    throw error;
  }
  return { latitude: lat, longitude: lon };
}

function validateSearch(body) {
  const origin = validateOrigin(body && body.latitude, body && body.longitude);
  const category = clean(body && body.category);
  const maxWalkMinutes = Math.round(num(body && body.maxWalkMinutes) ?? 15);
  if (!category || !CATEGORY_QUERY[category]) {
    const error = new Error('INVALID_CATEGORY');
    error.status = 400;
    throw error;
  }
  if (maxWalkMinutes < 5 || maxWalkMinutes > 30) {
    const error = new Error('INVALID_WALK_LIMIT');
    error.status = 400;
    throw error;
  }
  const openNowOnly = Boolean(body && body.openNowOnly);
  const minOpenMinutes = Math.round(num(body && body.minOpenMinutes) ?? 0);
  if (minOpenMinutes < 0 || minOpenMinutes > 360) {
    const error = new Error('INVALID_MIN_OPEN_MINUTES');
    error.status = 400;
    throw error;
  }
  return { ...origin, category, maxWalkMinutes, openNowOnly,
    minOpenMinutes: openNowOnly ? minOpenMinutes : 0 };

}

async function fetchJson(url, options, source) {
  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, 12000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      const error = new Error(source + '_INVALID_JSON');
      error.status = 502;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(source + '_HTTP_' + response.status);
      error.status = 502;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      const timeoutError = new Error(source + '_TIMEOUT');
      timeoutError.status = 502;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function costNok(discoverCalls, routeCalls) {
  return Number((
    ((discoverCalls * COST_GUARD.discoverEurPer1000 +
      routeCalls * COST_GUARD.routeEurPer1000) / 1000) *
    COST_GUARD.nokPerEur
  ).toFixed(6));
}

function haversineMeters(aLat, aLon, bLat, bLon) {
  const rad = function (v) { return v * Math.PI / 180; };
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

function addressText(address) {
  if (!address || typeof address !== 'object') return '';
  const street = [clean(address.street), clean(address.houseNumber)].filter(Boolean).join(' ');
  const city = [clean(address.postalCode), clean(address.municipality)].filter(Boolean).join(' ');
  return [street, city, clean(address.country)].filter(Boolean).join(', ');
}

function wallClockToUtc(dateValue, timeValue, offsetSeconds) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue || ''));
  const offset = num(offsetSeconds);
  if (!date || !time || offset === null) return null;
  const hour = Number(time[1]);
  const extraDays = Math.floor(hour / 24);
  return Date.UTC(
    Number(date[1]),
    Number(date[2]) - 1,
    Number(date[3]) + extraDays,
    hour % 24,
    Number(time[2]),
    Number(time[3] || 0)
  ) - offset * 1000;
}

function openingStateNow(openingHours, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  if (!Array.isArray(openingHours) || openingHours.length === 0) {
    return { isOpenNow: null, closesAtMs: null, minutesUntilClose: null };
  }
  let sawValidRange = false;
  for (const day of openingHours) {
    if (!day || !Array.isArray(day.timeRanges)) continue;
    for (const range of day.timeRanges) {
      const start = wallClockToUtc(day.date, range && range.start, range && range.utcOffsetSeconds);
      let end = wallClockToUtc(day.date, range && range.end, range && range.utcOffsetSeconds);
      if (start === null || end === null) continue;
      if (end <= start) end += 24 * 60 * 60 * 1000;
      sawValidRange = true;
      if (now >= start && now < end) {
        return { isOpenNow: true, closesAtMs: end,
          minutesUntilClose: Math.floor((end - now) / 60000) };
      }
    }
  }
  return { isOpenNow: sawValidRange ? false : null, closesAtMs: null, minutesUntilClose: null };
}

function normalizeDiscoverPlace(item, input) {
  if (clean(item && item.type) !== 'poi') return null;
  const id = clean(item && item.id);
  const name = clean(item && item.title);
  const coordinates = item && item.position && item.position.coordinates;
  if (!id || !name || !Array.isArray(coordinates) || coordinates.length < 2) return null;

  const longitude = num(coordinates[0]);
  const latitude = num(coordinates[1]);
  if (latitude === null || longitude === null) return null;

  const types = Array.isArray(item && item.poiTypes) ? item.poiTypes : [];
  const sourceCategories = types
    .map(function (t) { return clean(t && t.id) || clean(t && t.name); })
    .filter(Boolean);
  if (sourceCategories.length === 0) sourceCategories.push(input.category);

  const openingState = openingStateNow(item && item.openingHours);
  const straightDistanceMeters =
    num(item && item.distanceInMeters) ??
    haversineMeters(input.latitude, input.longitude, latitude, longitude);

  return {
    id,
    name,
    categoryLabel:
      types.map(function (t) { return clean(t && t.name); }).find(Boolean) ||
      CATEGORY_QUERY[input.category],
    sourceCategories,
    latitude,
    longitude,
    address: addressText(item && item.address),
    countryCodeIso2: clean(item && item.address && item.address.countryCodeIso2),
    isOpenNow: openingState.isOpenNow,
    closesAtMs: openingState.closesAtMs,
    minutesUntilClose: openingState.minutesUntilClose,
    openingHoursKnown: openingState.isOpenNow !== null,
    sourceVerified: true,
    straightDistanceMeters: Math.max(0, Math.round(straightDistanceMeters)),
  };
}

function discoverRadiusMeters(maxWalkMinutes) {
  return Math.min(10000, Math.max(2500, Math.round(maxWalkMinutes * 250)));
}

async function discoverPlaces(apiKey, input, usage) {
  if (usage.tomtomDiscover >= 1) throw new Error('SEARCH_COST_CAP_REACHED');
  if (costNok(usage.tomtomDiscover + 1, usage.tomtomRoute) > SEARCH_COST_CAP_NOK) {
    throw new Error('SEARCH_COST_CAP_REACHED');
  }

  usage.tomtomDiscover += 1;
  const radius = discoverRadiusMeters(input.maxWalkMinutes);
  const attributes = [
    'id',
    'type',
    'title',
    'subtitles',
    'distanceInMeters',
    'position.coordinates',
    'address(country,countryCodeIso2,municipality,postalCode,street,houseNumber)',
    'poiTypes(id,name,parentId)',
  ];
  if (input.openNowOnly) {
    attributes.push('openingHours');
  }

  const response = await fetchJson(
    'https://api.tomtom.com/maps/orbis/places/discover',
    {
      method: 'POST',
      headers: {
        'TomTom-Api-Key': apiKey,
        'TomTom-Api-Version': '3',
        'Tracking-Id': crypto.randomUUID(),
        'Session-Id': crypto.randomUUID(),
        'Attributes': 'results(' + attributes.join(',') + ')',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en',
      },
      body: JSON.stringify({
        query: CATEGORY_QUERY[input.category],
        origin: {
          type: 'point',
          coordinates: [input.longitude, input.latitude],
        },
        maxResults: DISCOVER_LIMIT,
        filters: {
          types: ['poi'],
          geometry: {
            type: 'circle',
            center: [input.longitude, input.latitude],
            radiusInMeters: radius,
          },
        },
        preferences: {
          geometry: {
            type: 'point',
            coordinates: [input.longitude, input.latitude],
          },
        },
      }),
    },
    'TOMTOM_DISCOVER'
  );

  return (Array.isArray(response && response.results) ? response.results : [])
    .map(function (item) { return normalizeDiscoverPlace(item, input); })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.straightDistanceMeters - b.straightDistanceMeters ||
        a.name.localeCompare(b.name);
    });
}

function routingHost(place) {
  return String(place && place.countryCodeIso2 || '').toUpperCase() === 'KR'
    ? 'kr-api.tomtom.com'
    : 'api.tomtom.com';
}

async function routeOne(apiKey, input, place, usage) {
  if (usage.tomtomRoute >= MAX_ROUTE_CALLS) {
    return { ok: false, place, reason: 'ROUTE_BUDGET_EXHAUSTED' };
  }

  const nextCost = costNok(usage.tomtomDiscover, usage.tomtomRoute + 1);
  if (nextCost > SEARCH_COST_CAP_NOK) {
    return { ok: false, place, reason: 'ROUTE_COST_CAP_REACHED' };
  }

  usage.tomtomRoute += 1;
  const locations =
    input.latitude + ',' + input.longitude + ':' +
    place.latitude + ',' + place.longitude;

  const url = new URL(
    'https://' + routingHost(place) + '/routing/1/calculateRoute/' +
    locations + '/json'
  );
  url.searchParams.set('key', apiKey);
  url.searchParams.set('travelMode', 'pedestrian');
  url.searchParams.set('routeType', 'fastest');
  url.searchParams.set('traffic', 'false');
  url.searchParams.set('routeRepresentation', 'summaryOnly');
  url.searchParams.set('maxAlternatives', '0');

  try {
    const payload = await fetchJson(url.toString(), { method: 'GET' }, 'TOMTOM_ROUTE');
    const summary = payload && payload.routes && payload.routes[0] && payload.routes[0].summary;
    const seconds = num(summary && summary.travelTimeInSeconds);
    const meters = num(summary && summary.lengthInMeters);
    if (seconds === null || meters === null || seconds < 0 || meters < 0) {
      return { ok: false, place, reason: 'ROUTE_RESULT_INVALID' };
    }
    const directMeters = haversineMeters(
      input.latitude, input.longitude, place.latitude, place.longitude
    );
    if (meters + 25 < directMeters) {
      return { ok: false, place, reason: 'ROUTE_ENDPOINT_SANITY_FAILED' };
    }
    return {
      ok: true,
      place: {
        ...place,
        straightDistanceMeters: Math.max(0, Math.round(directMeters)),
        walkSeconds: Math.round(seconds),
        walkMinutes: Math.max(1, Math.ceil(seconds / 60)),
        walkDistanceMeters: Math.round(meters),
      },
    };
  } catch (error) {
    return {
      ok: false,
      place,
      reason: clean(error && error.message) || 'ROUTE_FAILED',
    };
  }
}

function topTenByWalkDistance(routed, maxWalkMinutes) {
  return routed
    .filter(Boolean)
    .filter(function (p) { return p.walkMinutes <= maxWalkMinutes; })
    .sort(function (a, b) {
      return a.walkDistanceMeters - b.walkDistanceMeters ||
        a.walkSeconds - b.walkSeconds ||
        a.name.localeCompare(b.name);
    })
    .slice(0, RESULT_LIMIT);
}

function proofState(options) {
  const routed = options.routed;
  const candidates = options.candidates;
  const nextIndex = options.nextIndex;
  const maxWalkMinutes = options.maxWalkMinutes;
  const openNowOnly = options.openNowOnly;
  const failedLowerBounds = options.failedLowerBounds || [];

  const top = topTenByWalkDistance(routed, maxWalkMinutes);
  let lowerBound = Infinity;

  for (const failed of failedLowerBounds) {
    if (Number.isFinite(failed)) lowerBound = Math.min(lowerBound, failed);
  }

  const maxPossibleWalkMeters = maxWalkMinutes * (5000 / 60);

  for (let i = nextIndex; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (
      candidate.straightDistanceMeters <= maxPossibleWalkMeters &&
      (!openNowOnly || candidate.isOpenNow === true)
    ) {
      lowerBound = Math.min(lowerBound, candidate.straightDistanceMeters);
      break;
    }
  }

  // Unknown opening hours fail closed during candidate selection. They are not
  // unresolved routing candidates and therefore must not keep proof open forever.
  if (top.length < RESULT_LIMIT) {
    return {
      // "Up to 10": fewer than ten is complete when every unresolved
      // candidate that could still fit the walking-time window is exhausted.
      proven: !Number.isFinite(lowerBound),
      top,
      lowerBound,
    };
  }

  const tenthDistance = top[RESULT_LIMIT - 1].walkDistanceMeters;
  return {
    proven: tenthDistance <= lowerBound,
    top,
    lowerBound,
  };
}

async function search(apiKey, raw) {
  const input = validateSearch(raw);
  const usage = { tomtomDiscover: 0, tomtomRoute: 0 };
  const candidates = await discoverPlaces(apiKey, input, usage);

  if (candidates.length === 0) {
    return {
      resultStatus: 'DEGRADED',
      reason: 'DISCOVERY_RETURNED_NO_CANDIDATES',
      places: [],
      summary: {
        requested: RESULT_LIMIT,
        returned: 0,
        exhaustedCandidates: false,
        discoveryCandidates: 0,
        sortedBy: 'ACTUAL_PEDESTRIAN_ROUTE_DISTANCE',
        discoverySource: 'TOMTOM_ORBIS_PLACES_CLOUD',
        routingSource: 'TOMTOM_CLOUD_PEDESTRIAN_ROUTING',
        openNowGate: input.openNowOnly ? 'TOMTOM_ORBIS_OPENING_HOURS_FAIL_CLOSED' : 'OFF',
        cloudOnly: true,
        international: true,
      },
      usage: {
        thisSearch: {
          ...usage,
          conservativeCostNok: costNok(usage.tomtomDiscover, usage.tomtomRoute),
          costCapNok: SEARCH_COST_CAP_NOK,
          worstCaseCostNok: WORST_CASE_SEARCH_COST_NOK,
          freeTierAssumed: false,
        },
      },
    };
  }


  if (input.openNowOnly) {
    const knownOpeningHours = candidates.filter(function (p) { return p.openingHoursKnown; }).length;
    if (knownOpeningHours === 0) {
      return {
        resultStatus: 'DEGRADED', reason: 'OPENING_HOURS_UNAVAILABLE', places: [],
        summary: { requested: RESULT_LIMIT, returned: 0, exhaustedCandidates: false,
          discoveryCandidates: candidates.length, sortedBy: 'ACTUAL_PEDESTRIAN_ROUTE_DISTANCE',
          discoverySource: 'TOMTOM_ORBIS_PLACES_CLOUD', routingSource: 'TOMTOM_CLOUD_PEDESTRIAN_ROUTING',
          openNowGate: 'TOMTOM_ORBIS_OPENING_HOURS_FAIL_CLOSED', cloudOnly: true, international: true },
        usage: { thisSearch: { ...usage, conservativeCostNok: costNok(usage.tomtomDiscover, usage.tomtomRoute),
          costCapNok: SEARCH_COST_CAP_NOK, worstCaseCostNok: WORST_CASE_SEARCH_COST_NOK, freeTierAssumed: false } },
      };
    }
  }

  const routed = [];
  const failedLowerBounds = [];
  let nextIndex = 0;
  let proof = proofState({
    routed,
    candidates,
    nextIndex,
    maxWalkMinutes: input.maxWalkMinutes,
    openNowOnly: input.openNowOnly,
    failedLowerBounds,
  });

  while (
    !proof.proven &&
    nextIndex < candidates.length &&
    usage.tomtomRoute < MAX_ROUTE_CALLS
  ) {
    const batch = [];

    while (
      nextIndex < candidates.length &&
      batch.length < ROUTE_BATCH_SIZE &&
      usage.tomtomRoute + batch.length < MAX_ROUTE_CALLS
    ) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;

      // Recompute the endpoint distance from the exact search origin and POI
      // coordinates; do not trust discovery distance metadata for this gate.
      candidate.straightDistanceMeters = Math.max(0, Math.round(haversineMeters(
        input.latitude, input.longitude, candidate.latitude, candidate.longitude
      )));
      if (candidate.straightDistanceMeters > input.maxWalkMinutes * (5000 / 60)) {
        continue;
      }

      if (input.openNowOnly) {
        if (candidate.isOpenNow !== true) continue;
        if (input.minOpenMinutes > 0 &&
            (!Number.isFinite(candidate.minutesUntilClose) ||
             candidate.minutesUntilClose < input.minOpenMinutes)) continue;
      }

      batch.push(candidate);
    }

    if (batch.length > 0) {
      const results = await Promise.all(
        batch.map(function (place) {
          return routeOne(apiKey, input, place, usage);
        })
      );

      for (const result of results) {
        if (result && result.ok && result.place) {
          routed.push(result.place);
        } else if (result && result.place) {
          failedLowerBounds.push(result.place.straightDistanceMeters);
        }
      }
    }

    proof = proofState({
      routed,
      candidates,
      nextIndex,
      maxWalkMinutes: input.maxWalkMinutes,
      openNowOnly: input.openNowOnly,
      failedLowerBounds,
    });

    if (!proof.proven && batch.length > 0 && nextIndex < candidates.length) {
      await new Promise(function (resolve) { setTimeout(resolve, 210); });
    }
  }

  proof = proofState({
    routed,
    candidates,
    nextIndex,
    maxWalkMinutes: input.maxWalkMinutes,
    openNowOnly: input.openNowOnly,
    failedLowerBounds,
  });

  const conservativeCostNok = costNok(
    usage.tomtomDiscover,
    usage.tomtomRoute
  );

  const shared = {
    summary: {
      requested: RESULT_LIMIT,
      sortedBy: 'ACTUAL_PEDESTRIAN_ROUTE_DISTANCE',
      discoverySource: 'TOMTOM_ORBIS_PLACES_CLOUD',
      routingSource: 'TOMTOM_CLOUD_PEDESTRIAN_ROUTING',
      openNowGate: input.openNowOnly ? 'TOMTOM_ORBIS_OPENING_HOURS_FAIL_CLOSED' : 'OFF',
      cloudOnly: true,
      international: true,
      discoveryCandidates: candidates.length,
    },
    usage: {
      thisSearch: {
        ...usage,
        conservativeCostNok,
        costCapNok: SEARCH_COST_CAP_NOK,
        worstCaseCostNok: WORST_CASE_SEARCH_COST_NOK,
        freeTierAssumed: false,
      },
    },
  };

  if (!proof.proven) {
    const capReached =
      usage.tomtomRoute >= MAX_ROUTE_CALLS ||
      costNok(usage.tomtomDiscover, usage.tomtomRoute + 1) > SEARCH_COST_CAP_NOK;
    return {
      resultStatus: 'DEGRADED',
      reason: capReached
        ? 'TOP10_NOT_PROVABLE_WITHIN_30_ORE_CAP'
        : 'RESULT_SET_NOT_PROVABLE',
      places: [],
      summary: {
        ...shared.summary,
        returned: 0,
        exhaustedCandidates: false,
      },
      usage: shared.usage,
    };
  }

  const places = proof.top;
  return {
    resultStatus: 'COMPLETE_TOP10',
    places,
    summary: {
      ...shared.summary,
      returned: places.length,
      exhaustedCandidates: places.length < RESULT_LIMIT,
      proof: 'MEASURED_WALK_DISTANCE_WITH_STRAIGHT_LINE_LOWER_BOUND',
    },
    usage: shared.usage,
  };
}

async function suggest(apiKey, body) {
  const query = clean(body && body.query);
  if (!query || query.length < 3) return { suggestions: [] };
  const origin = validateOrigin(body && body.latitude, body && body.longitude);

  const response = await fetchJson(
    'https://api.tomtom.com/maps/orbis/places/suggest',
    {
      method: 'POST',
      headers: {
        'TomTom-Api-Key': apiKey,
        'TomTom-Api-Version': '3',
        'Tracking-Id': crypto.randomUUID(),
        'Session-Id': crypto.randomUUID(),
        'Attributes': 'results(id,type,title,subtitles)',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'en',
      },
      body: JSON.stringify({
        query,
        maxResults: 5,
        origin: {
          type: 'point',
          coordinates: [origin.longitude, origin.latitude],
        },
        filters: {
          types: ['poi', 'address', 'street', 'intersection', 'area'],
        },
        preferences: {
          geometry: {
            type: 'point',
            coordinates: [origin.longitude, origin.latitude],
          },
        },
      }),
    },
    'TOMTOM_SUGGEST'
  );

  return {
    suggestions: (Array.isArray(response && response.results) ? response.results : [])
      .map(function (item) {
        const id = clean(item && item.id);
        const type = clean(item && item.type);
        const title = clean(item && item.title);
        if (!id || !type || !title || !DETAILS_TYPE_MAP[type]) return null;
        return {
          id,
          type,
          title,
          subtitle: Array.isArray(item && item.subtitles)
            ? item.subtitles.filter(function (v) { return typeof v === 'string'; }).join(', ')
            : '',
        };
      })
      .filter(Boolean),
  };
}

async function resolveLocation(apiKey, body) {
  const id = clean(body && body.id);
  const type = clean(body && body.type);
  const detailsType = type ? DETAILS_TYPE_MAP[type] : null;

  if (!id || !detailsType) {
    const error = new Error('INVALID_LOCATION_SELECTION');
    error.status = 400;
    throw error;
  }

  const response = await fetchJson(
    'https://api.tomtom.com/maps/orbis/places/details/' +
      encodeURIComponent(detailsType) + '/' + encodeURIComponent(id),
    {
      method: 'GET',
      headers: {
        'TomTom-Api-Key': apiKey,
        'TomTom-Api-Version': '3',
        'Tracking-Id': crypto.randomUUID(),
        'Attributes':
          'id,type,title,position.coordinates,' +
          'address(country,countryCodeIso2,municipality,postalCode,street,houseNumber)',
        'Accept': 'application/json',
        'Accept-Language': 'en',
      },
    },
    'TOMTOM_DETAILS'
  );

  const coordinates = response && response.position && response.position.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    const error = new Error('LOCATION_HAS_NO_COORDINATES');
    error.status = 502;
    throw error;
  }

  const longitude = num(coordinates[0]);
  const latitude = num(coordinates[1]);
  if (latitude === null || longitude === null) {
    const error = new Error('LOCATION_HAS_NO_COORDINATES');
    error.status = 502;
    throw error;
  }

  return {
    id,
    type,
    title: clean(response && response.title) || 'Selected location',
    address: addressText(response && response.address),
    latitude,
    longitude,
  };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return send(res, 200, {
      ok: true,
      buildId: BUILD_ID,
      tomtomConfigured: Boolean(clean(process.env.TOMTOM_API_KEY)),
      architecture: {
        mapDisplay: 'GOOGLE_MAPS_SDK_LIVE',
        gps: 'DEVICE_CURRENT_LOCATION',
        placeDiscovery: 'TOMTOM_ORBIS_PLACES_CLOUD',
        walkingRoutes: 'TOMTOM_CLOUD_PEDESTRIAN_ROUTING',
        localRoutingData: false,
        international: true,
      },
      costContract: {
        capNok: SEARCH_COST_CAP_NOK,
        maxDiscoverCalls: 1,
        maxRouteCalls: MAX_ROUTE_CALLS,
        worstCaseNok: WORST_CASE_SEARCH_COST_NOK,
        freeTierAssumed: false,
      },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const apiKey = requireTomTomKey();
    const action = clean(req.body && req.body.action) || 'search';

    if (action === 'search') return send(res, 200, await search(apiKey, req.body));
    if (action === 'suggest') return send(res, 200, await suggest(apiKey, req.body));
    if (action === 'resolve') return send(res, 200, await resolveLocation(apiKey, req.body));

    return send(res, 400, { error: 'INVALID_ACTION' });
  } catch (error) {
    const status = Number(error && error.status) || 502;
    return send(res, status, {
      error: clean(error && error.message) || 'NATIVE_CLOUD_SEARCH_FAILED',
    });
  }
}

module.exports = handler;
module.exports._test = {
  BUILD_ID,
  CATEGORY_QUERY,
  COST_GUARD,
  DISCOVER_LIMIT,
  MAX_ROUTE_CALLS,
  RESULT_LIMIT,
  SEARCH_COST_CAP_NOK,
  WORST_CASE_SEARCH_COST_NOK,
  costNok,
  discoverRadiusMeters,
  haversineMeters,
  normalizeDiscoverPlace,
  openStateNow,
  proofState,
  topTenByWalkDistance,
  validateSearch,
};
