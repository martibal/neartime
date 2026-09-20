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
 */ const BUILD_ID = '2026-09-20-nearby-rating-filter-v41';
const RESULT_LIMIT = 10;
const DISCOVER_LIMIT = 100;
const MAX_ROUTE_CALLS = 24;
const ROUTE_BATCH_SIZE = 1;
const SEARCH_COST_CAP_NOK = 0.40;
const COST_GUARD = Object.freeze({
  discoverEurPer1000: 5.00,
  routeEurPer1000: 0.75,
  nokPerEur: 13.00
});
const WORST_CASE_SEARCH_COST_NOK = (COST_GUARD.discoverEurPer1000 + MAX_ROUTE_CALLS * COST_GUARD.routeEurPer1000) / 1000 * COST_GUARD.nokPerEur;
if (WORST_CASE_SEARCH_COST_NOK > SEARCH_COST_CAP_NOK) {
  throw new Error('SEARCH_COST_CONTRACT_BROKEN');
}
const GOOGLE_SEARCH_COST_NOK = 0.40;
const GOOGLE_CATEGORY_TYPES = Object.freeze({
  cafes_coffee:['cafe','coffee_shop'], restaurants:['restaurant'],
  fast_food_takeaway:['fast_food_restaurant'], bars_drinks:['bar','pub'], bakeries_sweets:['bakery'],
  groceries_supermarkets:['supermarket','grocery_store'], clothing_fashion:['clothing_store'],
  electronics:['electronics_store'], home_furniture:['furniture_store','home_goods_store'],
  shopping_centres:['shopping_mall'], other_shops:['store'], pharmacy:['pharmacy','drugstore'],
  doctor_clinic:['doctor','medical_clinic'], dentist:['dentist','dental_clinic'],
  hospital:['hospital'], spa_wellness:['spa'], gym_fitness:['gym'], swimming:['swimming_pool'],
  sports_facilities:['sports_complex'], golf:['golf_course'], parking:['parking'],
  public_transport:['transit_station'], train_stations:['train_station'], bus_stations_stops:['bus_station'],
  fuel_stations:['gas_station'], ev_charging:['electric_vehicle_charging_station'], airports:['airport'],
  schools:['school'], preschool:['preschool'], universities:['university'], libraries:['library'],
  parks:['park'], outdoor_activities:['hiking_area'], museums_galleries:['museum','art_gallery'],
  cinema:['movie_theater'], entertainment:['amusement_center'], attractions:['tourist_attraction'],
  playgrounds:['playground'], hotels:['hotel'], hostels_guest_houses:['hostel','guest_house'],
  camping:['campground'], hair_beauty:['hair_salon','beauty_salon'], laundry:['laundry'],
  banks:['bank'], atm:['atm'], post_office:['post_office'], shipping_courier:['courier_service'],
  car_repair_tyres:['car_repair','tire_shop'], car_wash:['car_wash'], veterinary:['veterinary_care'],
  pet_care:['pet_care'], pet_stores:['pet_store']
});

const BAD_POI_IDS = new Set([
  // TomTom Orbis record has Oslo coordinates but belongs to Kompasset on Østre Bolæren.
  // Fail closed: never route or display a provider record with known corrupt identity/location.
  'bsMa2GuMVXs7_ksSj239kw'
]);
const CATEGORY_POI_TYPES = Object.freeze({
  cafes_coffee: [
    'cafe'
  ],
  restaurants: [
    'restaurant'
  ],
  fast_food_takeaway: [
    'fast_food'
  ],
  bars_drinks: [
    'bar',
    'pub'
  ],
  bakeries_sweets: [
    'bakery'
  ],
  groceries_supermarkets: [
    'supermarket'
  ]
});
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
  pet_stores: 'pet supply store'
});
const DETAILS_TYPE_MAP = Object.freeze({
  poi: 'pois',
  address: 'addresses',
  street: 'streets',
  intersection: 'intersections',
  area: 'areas'
});
function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
async function requireTomTomKey() {
  const direct = clean(Deno.env.get('TOMTOM_API_KEY'));
  if (direct) return direct;
  const supabaseUrl = clean(Deno.env.get('SUPABASE_URL'));
  const serviceRole = clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (!supabaseUrl || !serviceRole) {
    const e = new Error('TOMTOM_API_KEY_NOT_CONFIGURED');
    e.status = 503;
    throw e;
  }
  const rpc = await fetch(supabaseUrl + '/rest/v1/rpc/neartime_runtime_secret', {
    method: 'POST',
    headers: {
      apikey: serviceRole,
      Authorization: 'Bearer ' + serviceRole,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_name: 'neartime_tomtom_api_key'
    })
  });
  if (!rpc.ok) {
    const e = new Error('TOMTOM_API_KEY_NOT_CONFIGURED');
    e.status = 503;
    throw e;
  }
  const value = clean(await rpc.json());
  if (!value) {
    const e = new Error('TOMTOM_API_KEY_NOT_CONFIGURED');
    e.status = 503;
    throw e;
  }
  return value;
}
function validateOrigin(latitude, longitude) {
  const lat = num(latitude);
  const lon = num(longitude);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    const error = new Error('INVALID_LOCATION');
    error.status = 400;
    throw error;
  }
  return {
    latitude: lat,
    longitude: lon
  };
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
  const minRatingRaw = num(body && body.minRating) ?? 0;
  if (minRatingRaw < 0 || minRatingRaw > 5) {
    const error = new Error('INVALID_MIN_RATING');
    error.status = 400;
    throw error;
  }
  const minRating = Math.round(minRatingRaw * 2) / 2;
  return {
    ...origin,
    category,
    maxWalkMinutes,
    openNowOnly,
    minOpenMinutes: openNowOnly ? minOpenMinutes : 0,
    minRating
  };
}
async function fetchJson(url, options, source) {
  const controller = new AbortController();
  const timeout = setTimeout(function() {
    controller.abort();
  }, 12000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch  {
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
  } finally{
    clearTimeout(timeout);
  }
}
function costNok(discoverCalls, routeCalls) {
  return Number(((discoverCalls * COST_GUARD.discoverEurPer1000 + routeCalls * COST_GUARD.routeEurPer1000) / 1000 * COST_GUARD.nokPerEur).toFixed(6));
}
function haversineMeters(aLat, aLon, bLat, bLon) {
  const rad = function(v) {
    return v * Math.PI / 180;
  };
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}
function addressText(address) {
  if (!address || typeof address !== 'object') return '';
  const street = [
    clean(address.street),
    clean(address.houseNumber)
  ].filter(Boolean).join(' ');
  const city = [
    clean(address.postalCode),
    clean(address.municipality)
  ].filter(Boolean).join(' ');
  return [
    street,
    city,
    clean(address.country)
  ].filter(Boolean).join(', ');
}
function wallClockToUtc(dateValue, timeValue, offsetSeconds) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue || ''));
  const offset = num(offsetSeconds);
  if (!date || !time || offset === null) return null;
  const hour = Number(time[1]);
  const extraDays = Math.floor(hour / 24);
  return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]) + extraDays, hour % 24, Number(time[2]), Number(time[3] || 0)) - offset * 1000;
}
function openingStateNow(openingHours, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  if (!Array.isArray(openingHours) || openingHours.length === 0) {
    return {
      isOpenNow: null,
      closesAtMs: null,
      minutesUntilClose: null
    };
  }
  let sawValidRange = false;
  for (const day of openingHours){
    if (!day || !Array.isArray(day.timeRanges)) continue;
    for (const range of day.timeRanges){
      const start = wallClockToUtc(day.date, range && range.start, range && range.utcOffsetSeconds);
      let end = wallClockToUtc(day.date, range && range.end, range && range.utcOffsetSeconds);
      if (start === null || end === null) continue;
      // Some feeds represent an overnight range with an end clock earlier
      // than the start clock. Treat that end as the following local day.
      if (end <= start) end += 24 * 60 * 60 * 1000;
      sawValidRange = true;
      if (now >= start && now < end) {
        return {
          isOpenNow: true,
          closesAtMs: end,
          minutesUntilClose: Math.floor((end - now) / 60000)
        };
      }
    }
  }
  return {
    isOpenNow: sawValidRange ? false : null,
    closesAtMs: null,
    minutesUntilClose: null
  };
}
function normalizeDiscoverPlace(item, input) {
  if (clean(item && item.type) !== 'poi') return null;
  const id = clean(item && item.id);
  const name = clean(item && item.title);
  if (id && BAD_POI_IDS.has(id)) return null;
  const coordinates = item && item.position && item.position.coordinates;
  if (!id || !name || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = num(coordinates[0]);
  const latitude = num(coordinates[1]);
  if (latitude === null || longitude === null) return null;
  const types = Array.isArray(item && item.poiTypes) ? item.poiTypes : [];
  const sourceCategories = types.map(function(t) {
    return clean(t && t.id) || clean(t && t.name);
  }).filter(Boolean);
  const sourceCategoryDetails = types.map(function(t) {
    return {
      id: clean(t && t.id),
      name: clean(t && t.name),
      parentId: clean(t && t.parentId)
    };
  }).filter(function(t) {
    return t.id || t.name;
  });
  if (sourceCategories.length === 0) sourceCategories.push(input.category);
  const openingState = openingStateNow(item && item.openingHours);
  const straightDistanceMeters = num(item && item.distanceInMeters) ?? haversineMeters(input.latitude, input.longitude, latitude, longitude);
  return {
    id,
    name,
    categoryLabel: types.map(function(t) {
      return clean(t && t.name);
    }).find(Boolean) || CATEGORY_QUERY[input.category],
    sourceCategories,
    sourceCategoryDetails,
    latitude,
    longitude,
    address: addressText(item && item.address),
    countryCodeIso2: clean(item && item.address && item.address.countryCodeIso2),
    isOpenNow: openingState.isOpenNow,
    closesAtMs: openingState.closesAtMs,
    minutesUntilClose: openingState.minutesUntilClose,
    openingHoursKnown: openingState.isOpenNow !== null,
    sourceVerified: true,
    straightDistanceMeters: Math.max(0, Math.round(straightDistanceMeters))
  };
}
function discoverRadiusMeters(maxWalkMinutes) {
  return Math.min(10000, Math.max(2500, Math.round(maxWalkMinutes * 250)));
}
function textSearchRestrictionRectangle(latitude, longitude, radiusMeters) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  const radius = Math.max(1, Number(radiusMeters) || 1);
  const metersPerDegree = 111320;
  const latDelta = radius / metersPerDegree;
  const lowLatitude = Math.max(-90, lat - latDelta);
  const highLatitude = Math.min(90, lat + latDelta);

  if (lowLatitude <= -89.999999 || highLatitude >= 89.999999) {
    return {
      low: { latitude: lowLatitude, longitude: -180 },
      high: { latitude: highLatitude, longitude: 180 }
    };
  }

  const cosLat = Math.max(0.01, Math.abs(Math.cos(lat * Math.PI / 180)));
  const lonDelta = Math.min(179.999, radius / (metersPerDegree * cosLat));
  const normalizeLongitude = (value) => {
    let normalized = value;
    while (normalized < -180) normalized += 360;
    while (normalized > 180) normalized -= 360;
    return normalized;
  };

  return {
    low: {
      latitude: lowLatitude,
      longitude: normalizeLongitude(lon - lonDelta)
    },
    high: {
      latitude: highLatitude,
      longitude: normalizeLongitude(lon + lonDelta)
    }
  };
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
    'poiTypes(id,name,parentId)'
  ];
  if (input.openNowOnly) {
    // Places Search API v1 openingHours is an array of dated ranges.
    // Request the whole field; nested field selection was yielding no usable data.
    attributes.push('openingHours');
  }
  const response = await fetchJson('https://api.tomtom.com/maps/orbis/places/discover', {
    method: 'POST',
    headers: {
      'TomTom-Api-Key': apiKey,
      'TomTom-Api-Version': '3',
      'Tracking-Id': crypto.randomUUID(),
      'Session-Id': crypto.randomUUID(),
      'Attributes': 'results(' + attributes.join(',') + ')',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en'
    },
    body: JSON.stringify({
      // Prefer the provider's structured POI taxonomy over free-text category
      // search. A parent POI type such as "restaurant" includes its children
      // (for example sushi, Indian, kebab/fast-food classifications) without
      // spending a second Discover call. Fall back to the legacy text query
      // only for categories not yet mapped to an Orbis POI type.
      query: CATEGORY_QUERY[input.category],
      origin: {
        type: 'point',
        coordinates: [
          input.longitude,
          input.latitude
        ]
      },
      maxResults: DISCOVER_LIMIT,
      filters: {
        types: [
          'poi'
        ],
        geometry: {
          type: 'circle',
          center: [
            input.longitude,
            input.latitude
          ],
          radiusInMeters: radius
        }
      },
      preferences: {
        geometry: {
          type: 'point',
          coordinates: [
            input.longitude,
            input.latitude
          ]
        }
      }
    })
  }, 'TOMTOM_DISCOVER');
  return (Array.isArray(response && response.results) ? response.results : []).map(function(item) {
    return normalizeDiscoverPlace(item, input);
  }).filter(Boolean).sort(function(a, b) {
    return a.straightDistanceMeters - b.straightDistanceMeters || a.name.localeCompare(b.name);
  });
}
function routingHost(place) {
  return String(place && place.countryCodeIso2 || '').toUpperCase() === 'KR' ? 'kr-api.tomtom.com' : 'api.tomtom.com';
}
async function routeOne(apiKey, input, place, usage) {
  if (usage.tomtomRoute >= MAX_ROUTE_CALLS) {
    return {
      ok: false,
      place,
      reason: 'ROUTE_BUDGET_EXHAUSTED'
    };
  }
  const nextCost = costNok(usage.tomtomDiscover, usage.tomtomRoute + 1);
  if (nextCost > SEARCH_COST_CAP_NOK) {
    return {
      ok: false,
      place,
      reason: 'ROUTE_COST_CAP_REACHED'
    };
  }
  usage.tomtomRoute += 1;
  const locations = input.latitude + ',' + input.longitude + ':' + place.latitude + ',' + place.longitude;
  const url = new URL('https://' + routingHost(place) + '/routing/1/calculateRoute/' + locations + '/json');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('travelMode', 'pedestrian');
  url.searchParams.set('routeType', 'fastest');
  url.searchParams.set('traffic', 'false');
  url.searchParams.set('routeRepresentation', 'summaryOnly');
  url.searchParams.set('maxAlternatives', '0');
  try {
    const payload = await fetchJson(url.toString(), {
      method: 'GET'
    }, 'TOMTOM_ROUTE');
    const summary = payload && payload.routes && payload.routes[0] && payload.routes[0].summary;
    const seconds = num(summary && summary.travelTimeInSeconds);
    const meters = num(summary && summary.lengthInMeters);
    if (seconds === null || meters === null || seconds < 0 || meters < 0) {
      return {
        ok: false,
        place,
        reason: 'ROUTE_RESULT_INVALID'
      };
    }
    const directMeters = haversineMeters(input.latitude, input.longitude, place.latitude, place.longitude);
    // Route geometry cannot be shorter than the geodesic endpoint distance.
    // Reject inconsistent provider/coordinate results instead of surfacing them.
    if (meters + 25 < directMeters) {
      return {
        ok: false,
        place,
        reason: 'ROUTE_ENDPOINT_SANITY_FAILED'
      };
    }
    return {
      ok: true,
      place: {
        ...place,
        straightDistanceMeters: Math.max(0, Math.round(directMeters)),
        walkSeconds: Math.round(seconds),
        walkMinutes: Math.max(1, Math.ceil(seconds / 60)),
        walkDistanceMeters: Math.round(meters)
      }
    };
  } catch (error) {
    return {
      ok: false,
      place,
      reason: clean(error && error.message) || 'ROUTE_FAILED'
    };
  }
}
function topTenByWalkDistance(routed, maxWalkMinutes) {
  return routed.filter(Boolean).filter(function(p) {
    return p.walkMinutes <= maxWalkMinutes;
  }).sort(function(a, b) {
    return a.walkDistanceMeters - b.walkDistanceMeters || a.walkSeconds - b.walkSeconds || a.name.localeCompare(b.name);
  }).slice(0, RESULT_LIMIT);
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
  for (const failed of failedLowerBounds){
    if (Number.isFinite(failed)) lowerBound = Math.min(lowerBound, failed);
  }
  const maxPossibleWalkMeters = maxWalkMinutes * (5000 / 60);
  for(let i = nextIndex; i < candidates.length; i += 1){
    const candidate = candidates[i];
    if (candidate.straightDistanceMeters <= maxPossibleWalkMeters && (!openNowOnly || candidate.isOpenNow !== false)) {
      lowerBound = Math.min(lowerBound, candidate.straightDistanceMeters);
      break;
    }
  }
  // When Open now is enabled, only confirmed-closed candidates can be removed
  // from the proof set. Unknown opening hours remain eligible and must be routed
  // before a nearer Top 10 can be proven.
  if (top.length < RESULT_LIMIT) {
    return {
      proven: !Number.isFinite(lowerBound),
      top,
      lowerBound
    };
  }
  const tenthDistance = top[RESULT_LIMIT - 1].walkDistanceMeters;
  return {
    proven: tenthDistance <= lowerBound,
    top,
    lowerBound
  };
}
async function requireGooglePlacesKey() {
  const key = clean(Deno.env.get('GOOGLE_PLACES_API_KEY'));
  if (!key) { const e = new Error('GOOGLE_PLACES_API_KEY_NOT_CONFIGURED'); e.status = 503; throw e; }
  return key;
}
function googleDurationSeconds(v) {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(v || ''));
  return m ? Number(m[1]) : null;
}
function googleOpeningState(place) {
  const h = place && place.currentOpeningHours;
  if (!h || typeof h.openNow !== 'boolean') {
    return {isOpenNow:null,closesAtMs:null,minutesUntilClose:null,openingHoursKnown:false};
  }
  const closeMs = h.nextCloseTime ? Date.parse(h.nextCloseTime) : NaN;
  return {
    isOpenNow:h.openNow,
    closesAtMs:Number.isFinite(closeMs)?closeMs:null,
    minutesUntilClose:Number.isFinite(closeMs)
      ?Math.max(0,Math.floor((closeMs-Date.now())/60000))
      :null,
    openingHoursKnown:true
  };
}
function googleMoneyText(money) {
  if (!money || typeof money !== 'object') return null;
  const currency = clean(money.currencyCode);
  const units = Number(money.units ?? 0);
  const nanos = Number(money.nanos ?? 0);
  if (!currency || !Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  const amount = units + nanos / 1000000000;
  const formatted = Number.isInteger(amount)
    ?String(amount)
    :amount.toFixed(2).replace(/\.00$/, '');
  return formatted + ' ' + currency;
}
function googlePriceRangeText(place) {
  const range = place && place.priceRange;
  if (!range || typeof range !== 'object') return null;
  const start = googleMoneyText(range.startPrice);
  const end = googleMoneyText(range.endPrice);
  if (start && end) {
    const startParts = start.split(' ');
    const endParts = end.split(' ');
    if (startParts.length === 2 && endParts.length === 2 && startParts[1] === endParts[1]) {
      return startParts[0] + '–' + endParts[0] + ' ' + startParts[1];
    }
    return start + '–' + end;
  }
  if (start) return 'From ' + start;
  if (end) return 'Under ' + end;
  return null;
}
function googlePriceLevelText(level) {
  const map = {
    PRICE_LEVEL_FREE:'Free',
    PRICE_LEVEL_INEXPENSIVE:'$',
    PRICE_LEVEL_MODERATE:'$$',
    PRICE_LEVEL_EXPENSIVE:'$$$',
    PRICE_LEVEL_VERY_EXPENSIVE:'$$$$'
  };
  return map[String(level || '')] || null;
}
async function search(_tomTomKey, raw, beforeProviderAttempt) {
  const input = validateSearch(raw);
  const key = await requireGooglePlacesKey();
  const includedTypes = GOOGLE_CATEGORY_TYPES[input.category];
  if (!includedTypes || !includedTypes.length) {
    const e = new Error('GOOGLE_CATEGORY_NOT_MAPPED');
    e.status = 500;
    throw e;
  }
  if (GOOGLE_SEARCH_COST_NOK > SEARCH_COST_CAP_NOK) {
    const e = new Error('SEARCH_COST_CONTRACT_BROKEN');
    e.status = 503;
    throw e;
  }

  const radius = discoverRadiusMeters(input.maxWalkMinutes);
  const fieldMask =
    'places.id,places.displayName,places.formattedAddress,places.location,' +
    'places.primaryType,places.primaryTypeDisplayName,places.types,places.businessStatus,' +
    'places.currentOpeningHours,places.rating,places.userRatingCount,places.priceLevel,' +
    'places.priceRange,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,' +
    'places.attributions,routingSummaries';

  const commonHeaders = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask': fieldMask,
    'Accept-Language': 'en'
  };

  let payload;
  const discoverySource = 'GOOGLE_PLACES_NEARBY_SEARCH_NEW';

  // Always use Nearby Search for category searches, including when a minimum
  // rating is selected. This preserves local distance-ranked candidate
  // acquisition. Text Search with minRating can fill its 20-result page with
  // farther text-relevance matches and omit nearby qualifying places.
  if (beforeProviderAttempt) {
    await beforeProviderAttempt({
      googleNearbyCalls: 1,
      googleTextCalls: 0,
      googleRoutingSummaryPlaces: 0,
      conservativeCostNok: GOOGLE_SEARCH_COST_NOK,
      costCapNok: SEARCH_COST_CAP_NOK
    });
  }

  payload = await fetchJson(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        includedTypes,
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: {
          circle: {
            center: {
              latitude: input.latitude,
              longitude: input.longitude
            },
            radius
          }
        },
        routingParameters: {
          origin: {
            latitude: input.latitude,
            longitude: input.longitude
          },
          travelMode: 'WALK'
        }
      })
    },
    'GOOGLE_NEARBY'
  );

  const places = Array.isArray(payload && payload.places) ? payload.places : [];
  const summaries = Array.isArray(payload && payload.routingSummaries)
    ? payload.routingSummaries
    : [];
  const out = [];

  for (let i = 0; i < places.length; i += 1) {
    const p = places[i] || {};
    const leg = summaries[i] && summaries[i].legs && summaries[i].legs[0];
    const sec = googleDurationSeconds(leg && leg.duration);
    const meters = num(leg && leg.distanceMeters);
    const lat = num(p.location && p.location.latitude);
    const lon = num(p.location && p.location.longitude);
    const id = clean(p.id);
    const name = clean(p.displayName && p.displayName.text);

    if (!id || !name || lat === null || lon === null || sec === null || meters === null) continue;
    if (clean(p.businessStatus) === 'CLOSED_PERMANENTLY') continue;

    const sourceTypes = Array.isArray(p.types) ? p.types : [];
    if (!sourceTypes.some((type) => includedTypes.includes(type))) continue;

    const opening = googleOpeningState(p);
    if (input.openNowOnly && opening.isOpenNow !== true) continue;
    if (
      input.openNowOnly &&
      input.minOpenMinutes > 0 &&
      (!Number.isFinite(opening.minutesUntilClose) ||
        opening.minutesUntilClose < input.minOpenMinutes)
    ) continue;

    const walkMinutes = Math.max(1, Math.ceil(sec / 60));
    if (walkMinutes > input.maxWalkMinutes) continue;

    const rating = num(p.rating);
    // Rating is a strict local hard filter over the distance-ranked Nearby
    // candidate set. A place below the selected floor never reaches the app.
    if (input.minRating > 0 && (rating === null || rating < input.minRating)) continue;

    const userRatingCount = Number.isFinite(Number(p.userRatingCount))
      ? Math.max(0, Math.round(Number(p.userRatingCount)))
      : null;
    const providerAttributions = Array.isArray(p.attributions)
      ? p.attributions.map((a) => clean(a && a.provider)).filter(Boolean)
      : [];

    out.push({
      id,
      name,
      categoryLabel:
        clean(p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) ||
        clean(p.primaryType) ||
        CATEGORY_QUERY[input.category],
      sourceCategories: sourceTypes,
      sourceCategoryDetails: [],
      latitude: lat,
      longitude: lon,
      address: clean(p.formattedAddress) || '',
      countryCodeIso2: null,
      isOpenNow: opening.isOpenNow,
      closesAtMs: opening.closesAtMs,
      minutesUntilClose: opening.minutesUntilClose,
      openingHoursKnown: opening.openingHoursKnown,
      rating: rating !== null ? Number(rating.toFixed(1)) : null,
      userRatingCount,
      priceLevel: googlePriceLevelText(p.priceLevel),
      priceRangeText: googlePriceRangeText(p),
      nationalPhoneNumber: clean(p.nationalPhoneNumber),
      websiteUri: clean(p.websiteUri),
      googleMapsUri: clean(p.googleMapsUri),
      providerAttributions,
      businessStatus: clean(p.businessStatus),
      sourceVerified: true,
      straightDistanceMeters: Math.round(
        haversineMeters(input.latitude, input.longitude, lat, lon)
      ),
      walkSeconds: Math.round(sec),
      walkMinutes,
      walkDistanceMeters: Math.round(meters)
    });
  }

  out.sort(
    (a, b) =>
      a.walkDistanceMeters - b.walkDistanceMeters ||
      a.walkSeconds - b.walkSeconds ||
      a.name.localeCompare(b.name)
  );

  const top = out.slice(0, RESULT_LIMIT);
  const completeness =
    top.length >= RESULT_LIMIT
      ? 'COMPLETE_TOP10'
      : places.length < 20
        ? 'EXHAUSTED_GOOGLE_CANDIDATES'
        : 'PARTIAL_CANDIDATE_LIMIT';

  return {
    resultStatus: completeness,
    places: top,
    summary: {
      requested: RESULT_LIMIT,
      returned: top.length,
      exhaustedCandidates: places.length < 20,
      sortedBy: 'GOOGLE_WALK_ROUTE_DISTANCE',
      discoverySource,
      routingSource: 'GOOGLE_PLACES_ROUTING_SUMMARIES_WALK',
      ratingGate:
        input.minRating > 0
          ? 'LOCAL_HARD_MIN_RATING_' + input.minRating.toFixed(1)
          : 'OFF',
      openNowGate: input.openNowOnly ? 'STRICT_CONFIRMED_OPEN_ONLY' : 'OFF',
      cloudOnly: true,
      international: true,
      discoveryCandidates: places.length,
      candidateLimit: 20,
      googleReturnedNames: places
        .map((p) => clean(p.displayName && p.displayName.text))
        .filter(Boolean),
      proof:
        top.length >= RESULT_LIMIT
          ? 'TEN_QUALIFYING_FROM_DISTANCE_RANKED_GOOGLE_SET'
          : places.length < 20
            ? 'GOOGLE_RETURNED_FEWER_THAN_CANDIDATE_LIMIT'
            : 'GOOGLE_CANDIDATE_LIMIT_REACHED_NOT_PROVEN_EXHAUSTIVE'
    },
    usage: {
      thisSearch: {
        googleNearbyCalls: 1,
        googleTextCalls: 0,
        googleRoutingSummaryPlaces: places.length,
        tomtomDiscover: 0,
        tomtomRoute: 0,
        conservativeCostNok: GOOGLE_SEARCH_COST_NOK,
        costCapNok: SEARCH_COST_CAP_NOK,
        worstCaseCostNok: GOOGLE_SEARCH_COST_NOK,
        freeTierAssumed: false
      }
    }
  };
}

async function suggest(apiKey, body) {
  const query = clean(body && body.query);
  if (!query || query.length < 3) return {
    suggestions: []
  };
  const origin = validateOrigin(body && body.latitude, body && body.longitude);
  const response = await fetchJson('https://api.tomtom.com/maps/orbis/places/suggest', {
    method: 'POST',
    headers: {
      'TomTom-Api-Key': apiKey,
      'TomTom-Api-Version': '3',
      'Tracking-Id': crypto.randomUUID(),
      'Session-Id': crypto.randomUUID(),
      'Attributes': 'results(id,type,title,subtitles)',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Language': 'en'
    },
    body: JSON.stringify({
      query,
      maxResults: 5,
      origin: {
        type: 'point',
        coordinates: [
          origin.longitude,
          origin.latitude
        ]
      },
      filters: {
        types: [
          'poi',
          'address',
          'street',
          'intersection',
          'area'
        ]
      },
      preferences: {
        geometry: {
          type: 'point',
          coordinates: [
            origin.longitude,
            origin.latitude
          ]
        }
      }
    })
  }, 'TOMTOM_SUGGEST');
  return {
    suggestions: (Array.isArray(response && response.results) ? response.results : []).map(function(item) {
      const id = clean(item && item.id);
      const type = clean(item && item.type);
      const title = clean(item && item.title);
      if (!id || !type || !title || !DETAILS_TYPE_MAP[type]) return null;
      return {
        id,
        type,
        title,
        subtitle: Array.isArray(item && item.subtitles) ? item.subtitles.filter(function(v) {
          return typeof v === 'string';
        }).join(', ') : ''
      };
    }).filter(Boolean)
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
  const response = await fetchJson('https://api.tomtom.com/maps/orbis/places/details/' + encodeURIComponent(detailsType) + '/' + encodeURIComponent(id), {
    method: 'GET',
    headers: {
      'TomTom-Api-Key': apiKey,
      'TomTom-Api-Version': '3',
      'Tracking-Id': crypto.randomUUID(),
      'Attributes': 'id,type,title,position.coordinates,' + 'address(country,countryCodeIso2,municipality,postalCode,street,houseNumber)',
      'Accept': 'application/json',
      'Accept-Language': 'en'
    }
  }, 'TOMTOM_DETAILS');
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
    longitude
  };
}
async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b)=>b.toString(16).padStart(2,'0')).join('');
}
function firstRow(value) {
  return Array.isArray(value) ? (value[0] || null) : value;
}
function validInstallHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
async function resolveEntitlementHash(body) {
  const token = clean(body && body.entitlementSession);
  if (!token) return null;
  const resolved = firstRow(await idempotencyRpc('resolve_entitlement_session', {
    p_token_hash: await sha256Hex(token)
  }));
  if (!resolved || !clean(resolved.entitlement_hash)) {
    const error = new Error('ENTITLEMENT_SESSION_INVALID');
    error.status = 401;
    throw error;
  }
  return clean(resolved.entitlement_hash);
}
async function usageStatus(body, entitlementHashOverride) {
  const installHash = clean(body && body.installHash);
  if (!validInstallHash(installHash)) {
    const error = new Error('INVALID_INSTALL_ID');
    error.status = 400;
    throw error;
  }
  const entitlementHash = entitlementHashOverride === undefined ? await resolveEntitlementHash(body) : entitlementHashOverride;
  const usage = firstRow(await idempotencyRpc('neartime_usage_status', {
    p_install_hash: installHash,
    p_entitlement_hash: entitlementHash
  }));
  return usage || {
    access_mode: entitlementHash ? 'subscriber' : 'trial',
    account_status: 'unknown',
    trial_included: 0,
    trial_used: 0,
    trial_remaining: 0,
    monthly_included: 0,
    monthly_used: 0,
    monthly_remaining: 0,
    extra_remaining: 0,
    total_available: 0,
    billing_period_end: null
  };
}
async function logicalRequestHash(body) {
  return await sha256Hex(JSON.stringify({
    latitude: Number(body && body.latitude),
    longitude: Number(body && body.longitude),
    category: clean(body && body.category),
    maxWalkMinutes: Number(body && body.maxWalkMinutes),
    openNowOnly: Boolean(body && body.openNowOnly),
    minOpenMinutes: Number(body && body.minOpenMinutes) || 0,
    minRating: Number(body && body.minRating) || 0
  }));
}
async function quotaSearch(body, requestId) {
  const installHash = clean(body && body.installHash);
  if (!validInstallHash(installHash)) {
    const error = new Error('INVALID_INSTALL_ID');
    error.status = 400;
    throw error;
  }
  if (!requestId) {
    const error = new Error('REQUEST_ID_REQUIRED');
    error.status = 400;
    throw error;
  }

  const entitlementHash = await resolveEntitlementHash(body);
  const authorization = firstRow(await idempotencyRpc('neartime_authorize_search_v2', {
    p_install_hash: installHash,
    p_entitlement_hash: entitlementHash,
    p_idempotency_key: requestId,
    p_request_hash: await logicalRequestHash(body)
  }));

  if (!authorization) throw new Error('SEARCH_QUOTA_AUTHORIZATION_FAILED');

  if (!authorization.allowed) {
    if (authorization.reason === 'idempotent_replay' && authorization.replay_response) {
      return {
        ...authorization.replay_response,
        quota: await usageStatus(body, entitlementHash)
      };
    }
    const error = new Error(String(authorization.reason || 'SEARCH_NOT_ALLOWED').toUpperCase());
    error.status = (
      authorization.reason === 'trial_exhausted' ||
      authorization.reason === 'paid_quota_exhausted'
    ) ? 402 : (authorization.reason === 'entitlement_inactive' ? 403 : 409);
    error.quota = await usageStatus(body, entitlementHash);
    throw error;
  }

  const reservationId = clean(authorization.reservation_id);
  if (!reservationId) throw new Error('SEARCH_QUOTA_RESERVATION_MISSING');

  let providerAttemptRecorded = false;
  let providerAttemptUsage = null;

  const recordProviderAttempt = async (usage) => {
    providerAttemptUsage = usage;
    await idempotencyRpc('neartime_record_search_cost_v3', {
      p_request_id: requestId,
      p_category: clean(body?.category) || clean(body?.categoryId) || 'unknown',
      p_max_walk_minutes: Number(body?.maxWalkMinutes) || 0,
      p_open_now_only: Boolean(body?.openNowOnly),
      p_result_status: 'PROVIDER_ATTEMPTED',
      p_result_count: 0,
      p_google_nearby_calls: Number(usage.googleNearbyCalls) || 0,
      p_google_text_calls: Number(usage.googleTextCalls) || 0,
      p_google_routing_summary_places: 0,
      p_tomtom_discover_calls: 0,
      p_tomtom_route_calls: 0,
      p_estimated_cost_nok: Number(usage.conservativeCostNok) || GOOGLE_SEARCH_COST_NOK,
      p_cost_cap_nok: Number(usage.costCapNok) || SEARCH_COST_CAP_NOK,
      p_build_id: BUILD_ID,
      p_provider_attempt_state: 'attempted',
      p_error_code: null
    });
    providerAttemptRecorded = true;
  };

  try {
    const result = await search(null, body, recordProviderAttempt);
    const usage = result?.usage?.thisSearch || {};

    try {
      await idempotencyRpc('neartime_record_search_cost_v3', {
        p_request_id: requestId,
        p_category: clean(body?.category) || clean(body?.categoryId) || 'unknown',
        p_max_walk_minutes: Number(body?.maxWalkMinutes) || 0,
        p_open_now_only: Boolean(body?.openNowOnly),
        p_result_status: clean(result?.resultStatus) || 'UNKNOWN',
        p_result_count: Array.isArray(result?.places) ? result.places.length : 0,
        p_google_nearby_calls: Number(usage.googleNearbyCalls) || 0,
        p_google_text_calls: Number(usage.googleTextCalls) || 0,
        p_google_routing_summary_places: Number(usage.googleRoutingSummaryPlaces) || 0,
        p_tomtom_discover_calls: Number(usage.tomtomDiscover) || 0,
        p_tomtom_route_calls: Number(usage.tomtomRoute) || 0,
        p_estimated_cost_nok: Number(usage.conservativeCostNok) || 0,
        p_cost_cap_nok: Number(usage.costCapNok) || SEARCH_COST_CAP_NOK,
        p_build_id: BUILD_ID,
        p_provider_attempt_state: 'succeeded',
        p_error_code: null
      });
    } catch (ledgerError) {
      console.error('COST_LEDGER_WRITE_FAILED', ledgerError);
    }

    await idempotencyRpc('neartime_finish_search_v2', {
      p_reservation_id: reservationId,
      p_outcome: 'succeeded',
      p_qualified_result: Array.isArray(result && result.places) && result.places.length > 0,
      p_response_payload: result,
      p_error_code: null
    });
    return {
      ...result,
      quota: await usageStatus(body, entitlementHash)
    };
  } catch (error) {
    if (providerAttemptRecorded) {
      try {
        const usage = providerAttemptUsage || {};
        await idempotencyRpc('neartime_record_search_cost_v3', {
          p_request_id: requestId,
          p_category: clean(body?.category) || clean(body?.categoryId) || 'unknown',
          p_max_walk_minutes: Number(body?.maxWalkMinutes) || 0,
          p_open_now_only: Boolean(body?.openNowOnly),
          p_result_status: 'PROVIDER_FAILED_AFTER_ATTEMPT',
          p_result_count: 0,
          p_google_nearby_calls: Number(usage.googleNearbyCalls) || 0,
          p_google_text_calls: Number(usage.googleTextCalls) || 0,
          p_google_routing_summary_places: 0,
          p_tomtom_discover_calls: 0,
          p_tomtom_route_calls: 0,
          p_estimated_cost_nok: Number(usage.conservativeCostNok) || GOOGLE_SEARCH_COST_NOK,
          p_cost_cap_nok: Number(usage.costCapNok) || SEARCH_COST_CAP_NOK,
          p_build_id: BUILD_ID,
          p_provider_attempt_state: 'failed_after_attempt',
          p_error_code: clean(error && error.message) || 'SEARCH_FAILED'
        });
      } catch (ledgerError) {
        console.error('COST_LEDGER_FAILURE_UPDATE_FAILED', ledgerError);
      }
    }

    try {
      await idempotencyRpc('neartime_finish_search_v2', {
        p_reservation_id: reservationId,
        p_outcome: 'released',
        p_qualified_result: false,
        p_response_payload: null,
        p_error_code: clean(error && error.message) || 'SEARCH_FAILED'
      });
    } catch (releaseError) {
      console.error('SEARCH_QUOTA_RELEASE_FAILED', releaseError);
    }
    throw error;
  }
}

async function idempotencyRpc(name, args) {
  const base = clean(Deno.env.get('SUPABASE_URL'));
  const serviceKey = clean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  if (!base || !serviceKey) throw new Error('IDEMPOTENCY_DATABASE_NOT_CONFIGURED');
  const res = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      'apikey': serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('RPC_FAILED', name, res.status, text.slice(0, 500));
    throw new Error('DATABASE_OPERATION_FAILED');
  }
  return text ? JSON.parse(text) : null;
}
async function idempotentSearch(apiKey, body, requestId) {
  if (!requestId) return await search(apiKey, body);
  const claim = await idempotencyRpc('neartime_idempotency_claim', {
    p_request_id: requestId
  });
  if (claim === 'complete') {
    const cached = await idempotencyRpc('neartime_idempotency_get', {
      p_request_id: requestId
    });
    if (cached) return cached;
    throw new Error('IDEMPOTENCY_RESULT_MISSING');
  }
  if (claim === 'running') {
    for(let attempt = 0; attempt < 40; attempt += 1){
      await new Promise((resolve)=>setTimeout(resolve, 250));
      const cached = await idempotencyRpc('neartime_idempotency_get', {
        p_request_id: requestId
      });
      if (cached) return cached;
    }
    const error = new Error('SEARCH_ALREADY_IN_PROGRESS');
    error.status = 409;
    throw error;
  }
  if (claim !== 'claimed') throw new Error('IDEMPOTENCY_CLAIM_FAILED');
  const result = await search(apiKey, body);
  await idempotencyRpc('neartime_idempotency_complete', {
    p_request_id: requestId,
    p_result: result
  });
  const usage = result?.usage?.thisSearch || {};
  try {
    await idempotencyRpc('neartime_record_search_cost', {
      p_request_id: requestId,
      p_category: clean(body?.category) || clean(body?.categoryId) || 'unknown',
      p_max_walk_minutes: Number(body?.maxWalkMinutes) || 0,
      p_open_now_only: Boolean(body?.openNowOnly),
      p_result_status: clean(result?.resultStatus) || 'UNKNOWN',
      p_result_count: Array.isArray(result?.places) ? result.places.length : 0,
      p_tomtom_discover_calls: Number(usage.tomtomDiscover) || 0,
      p_tomtom_route_calls: Number(usage.tomtomRoute) || 0,
      p_estimated_cost_nok: Number(usage.conservativeCostNok) || 0,
      p_cost_cap_nok: Number(usage.costCapNok) || SEARCH_COST_CAP_NOK,
      p_build_id: BUILD_ID
    });
  } catch (ledgerError) {
    console.error('COST_LEDGER_WRITE_FAILED', ledgerError);
  }
  return result;
}
Deno.serve(async function handler(req) {
  if (req.method === 'GET') {
    let configured = false;
    try { await requireTomTomKey(); configured = true; } catch {}
    return response(200, {
      ok: true,
      buildId: BUILD_ID,
      tomtomConfigured: configured,
      architecture: {
        mapHandoff: 'GOOGLE_MAPS_URL',
        gps: 'DEVICE_CURRENT_LOCATION',
        placeDiscovery: 'GOOGLE_PLACES_NEARBY_OR_TEXT_SEARCH_NEW',
        walkingRoutes: 'GOOGLE_PLACES_ROUTING_SUMMARIES_WALK',
        localRoutingData: false,
        international: true
      },
      monetization: { freeSearches: 5, monthlySearches: 30, extraPackSearches: 20 },
      costContract: {
        capNok: SEARCH_COST_CAP_NOK,
        maxGooglePlacesCalls: 1,
        worstCaseNok: GOOGLE_SEARCH_COST_NOK,
        freeTierAssumed: false
      }
    });
  }

  if (req.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = await req.json();
    const action = clean(body && body.action) || 'search';

    if (action === 'usage') {
      return response(200, { quota: await usageStatus(body) });
    }
    if (action === 'search') {
      const requestId = clean(req.headers.get('Idempotency-Key')) || clean(body && body.requestId);
      return response(200, await quotaSearch(body, requestId));
    }
    if (action === 'suggest') {
      const apiKey = await requireTomTomKey();
      return response(200, await suggest(apiKey, body));
    }
    if (action === 'resolve') {
      const apiKey = await requireTomTomKey();
      return response(200, await resolveLocation(apiKey, body));
    }
    return response(400, { error: 'INVALID_ACTION' });
  } catch (error) {
    return response(Number(error && error.status) || 502, {
      error: clean(error && error.message) || 'NATIVE_CLOUD_SEARCH_FAILED',
      quota: error && error.quota ? error.quota : undefined
    });
  }
});
