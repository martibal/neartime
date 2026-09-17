#!/usr/bin/env node
/**
 * NearTime backend — Google Nearby Search category/freshness architecture
 *
 * Place-search design:
 * - Google Nearby Search (New) is the ONE discovery/category/freshness call
 *   made per explicit place search.
 * - Open-now OFF: Nearby Search Pro fields only.
 * - Open-now ON: same one Nearby call, plus currentOpeningHours, then fail-closed
 *   on currentOpeningHours.openNow !== true.
 * - TomTom is used for pedestrian routing and for custom start-location
 *   suggest/details only. TomTom is not used for POI discovery.
 * - Results are never padded. If only 7 survive all gates, 7 are returned.
 * - User-intent categories that could starve one another in a 20-result OR pool are split (fuel/EV, bank/ATM, etc.).
 * - Individual result labels come from Google's actual primary place type.
 * - Hard monthly and per-search guards fail closed before provider calls.
 *
 * Runtime: Node.js 22+ (no npm packages required).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = clampInt(process.env.PORT, 1, 65535, 8081);
const TOMTOM_API_KEY = String(process.env.TOMTOM_API_KEY || '').trim();
const GOOGLE_PLACES_API_KEY = String(process.env.GOOGLE_PLACES_API_KEY || '').trim();
const BUILD_ID = '2026-09-17-category-split-52-v1';

const RESULT_LIMIT = 10;
const GOOGLE_NEARBY_CANDIDATE_LIMIT = 20; // Google Nearby Search maxResultCount max = 20.
const ROUTE_CANDIDATE_LIMIT = 20;
const GOOGLE_CALLS_PER_SEARCH_CAP = 1;
const TOMTOM_ROUTE_CALLS_PER_SEARCH_CAP = 20;
const TOMTOM_ROUTE_MIN_INTERVAL_MS = 300; // ~3.33 QPS, below TomTom default 5 QPS.
const HTTP_TIMEOUT_MS = 12000;

/*
 * These are NearTime test-period guards, not statements about provider pricing.
 * Environment variables may LOWER these caps but can never raise them.
 */
const HARD_MAX = Object.freeze({
  tomtomRoute: 15000,
  tomtomSuggest: 300,
  tomtomDetails: 300,
  googleNearbyPro: 900,
  googleNearbyEnterprise: 900
});

const MONTHLY_LIMITS = Object.freeze({
  tomtomRoute: clampInt(
    process.env.TOMTOM_ROUTE_MONTHLY_CAP,
    1,
    HARD_MAX.tomtomRoute,
    HARD_MAX.tomtomRoute
  ),
  tomtomSuggest: clampInt(
    process.env.TOMTOM_SUGGEST_MONTHLY_CAP,
    1,
    HARD_MAX.tomtomSuggest,
    HARD_MAX.tomtomSuggest
  ),
  tomtomDetails: clampInt(
    process.env.TOMTOM_DETAILS_MONTHLY_CAP,
    1,
    HARD_MAX.tomtomDetails,
    HARD_MAX.tomtomDetails
  ),
  googleNearbyPro: clampInt(
    process.env.GOOGLE_NEARBY_PRO_MONTHLY_CAP,
    1,
    HARD_MAX.googleNearbyPro,
    HARD_MAX.googleNearbyPro
  ),
  googleNearbyEnterprise: clampInt(
    process.env.GOOGLE_NEARBY_ENTERPRISE_MONTHLY_CAP,
    1,
    HARD_MAX.googleNearbyEnterprise,
    HARD_MAX.googleNearbyEnterprise
  )
});

const USAGE_DIR = path.resolve(process.env.USAGE_DIR || path.join(__dirname, '.usage'));
const USAGE_FILE = path.join(USAGE_DIR, 'api-usage.json');

/*
 * Every value below is a Google Places API (New) Table A type suitable for
 * Nearby Search includedTypes. Multiple includedTypes operate as OR.
 */
const CATEGORY_CONFIG = Object.freeze({
  cafes_coffee: {
    label: "Cafés & coffee",
    googleTypes: ["cafe", "coffee_shop", "cafeteria", "tea_house", "coffee_stand", "internet_cafe"]
  },
  restaurants: {
    label: "Restaurants",
    googleTypes: ["restaurant"]
  },
  fast_food_takeaway: {
    label: "Fast food & takeaway",
    googleTypes: ["fast_food_restaurant", "meal_takeaway", "food_court", "snack_bar", "sandwich_shop", "hot_dog_stand", "kebab_shop"]
  },
  bars_drinks: {
    label: "Bars & drinks",
    googleTypes: ["bar", "pub", "beer_garden", "cocktail_bar", "wine_bar", "lounge_bar", "sports_bar", "brewpub"]
  },
  bakeries_sweets: {
    label: "Bakeries & sweets",
    googleTypes: ["bakery", "pastry_shop", "cake_shop", "candy_store", "chocolate_shop", "confectionery", "dessert_shop", "donut_shop", "ice_cream_shop"]
  },
  groceries_supermarkets: {
    label: "Groceries & supermarkets",
    googleTypes: ["supermarket", "grocery_store", "convenience_store", "food_store", "hypermarket", "discount_supermarket", "market", "farmers_market", "asian_grocery_store"]
  },
  clothing_fashion: {
    label: "Clothing & fashion",
    googleTypes: ["clothing_store", "womens_clothing_store", "shoe_store", "sportswear_store"]
  },
  electronics: {
    label: "Electronics",
    googleTypes: ["electronics_store", "cell_phone_store"]
  },
  home_furniture: {
    label: "Home & furniture",
    googleTypes: ["furniture_store", "home_goods_store", "home_improvement_store", "hardware_store", "building_materials_store", "garden_center"]
  },
  shopping_centres: {
    label: "Shopping centres",
    googleTypes: ["shopping_mall"]
  },
  other_shops: {
    label: "Other shops",
    googleTypes: ["store", "department_store", "general_store", "gift_shop", "book_store", "toy_store", "thrift_store"]
  },
  pharmacy: {
    label: "Pharmacy",
    googleTypes: ["pharmacy", "drugstore"]
  },
  doctor_clinic: {
    label: "Doctor & clinic",
    googleTypes: ["doctor", "medical_clinic", "medical_center"]
  },
  dentist: {
    label: "Dentist",
    googleTypes: ["dentist", "dental_clinic"]
  },
  hospital: {
    label: "Hospital",
    googleTypes: ["hospital", "general_hospital"]
  },
  spa_wellness: {
    label: "Spa & wellness",
    googleTypes: ["spa", "massage_spa", "wellness_center", "massage", "sauna", "skin_care_clinic"]
  },
  gym_fitness: {
    label: "Gym & fitness",
    googleTypes: ["gym", "fitness_center", "yoga_studio", "sports_club"]
  },
  swimming: {
    label: "Swimming",
    googleTypes: ["swimming_pool"]
  },
  sports_facilities: {
    label: "Sports facilities",
    googleTypes: ["sports_complex", "sports_activity_location", "stadium", "arena", "athletic_field", "sports_club", "tennis_court", "ice_skating_rink"]
  },
  golf: {
    label: "Golf",
    googleTypes: ["golf_course", "indoor_golf_course", "miniature_golf_course"]
  },
  parking: {
    label: "Parking",
    googleTypes: ["parking", "parking_garage", "parking_lot", "park_and_ride"]
  },
  public_transport: {
    label: "Public transport",
    googleTypes: ["transit_station", "transit_stop", "bus_station", "bus_stop", "train_station", "subway_station", "light_rail_station", "tram_stop", "ferry_terminal"]
  },
  train_stations: {
    label: "Train stations",
    googleTypes: ["train_station", "light_rail_station", "subway_station"]
  },
  bus_stations_stops: {
    label: "Bus stations & stops",
    googleTypes: ["bus_station", "bus_stop", "transit_stop"]
  },
  fuel_stations: {
    label: "Fuel stations",
    googleTypes: ["gas_station"]
  },
  ev_charging: {
    label: "EV charging",
    googleTypes: ["electric_vehicle_charging_station"]
  },
  airports: {
    label: "Airports",
    googleTypes: ["airport", "international_airport", "airstrip", "heliport"]
  },
  schools: {
    label: "Schools",
    googleTypes: ["school", "primary_school", "secondary_school", "educational_institution"]
  },
  preschool: {
    label: "Preschool",
    googleTypes: ["preschool"]
  },
  universities: {
    label: "Universities",
    googleTypes: ["university", "academic_department"]
  },
  libraries: {
    label: "Libraries",
    googleTypes: ["library"]
  },
  parks: {
    label: "Parks",
    googleTypes: ["park", "city_park", "state_park", "national_park"]
  },
  outdoor_activities: {
    label: "Outdoor activities",
    googleTypes: ["hiking_area", "adventure_sports_center", "cycling_park", "ski_resort", "nature_preserve", "scenic_spot", "fishing_pier", "fishing_pond"]
  },
  museums_galleries: {
    label: "Museums & galleries",
    googleTypes: ["museum", "art_museum", "history_museum", "art_gallery", "cultural_center"]
  },
  cinema: {
    label: "Cinema",
    googleTypes: ["movie_theater"]
  },
  entertainment: {
    label: "Entertainment",
    googleTypes: ["amusement_center", "bowling_alley", "comedy_club", "live_music_venue", "karaoke", "video_arcade", "performing_arts_theater", "concert_hall"]
  },
  attractions: {
    label: "Attractions",
    googleTypes: ["tourist_attraction", "historical_landmark", "cultural_landmark", "monument", "observation_deck", "zoo", "aquarium", "amusement_park", "botanical_garden", "visitor_center"]
  },
  playgrounds: {
    label: "Playgrounds",
    googleTypes: ["playground", "indoor_playground"]
  },
  hotels: {
    label: "Hotels",
    googleTypes: ["hotel", "resort_hotel", "motel", "extended_stay_hotel"]
  },
  hostels_guest_houses: {
    label: "Hostels & guest houses",
    googleTypes: ["hostel", "guest_house", "bed_and_breakfast", "inn"]
  },
  camping: {
    label: "Camping",
    googleTypes: ["campground", "camping_cabin", "rv_park"]
  },
  hair_beauty: {
    label: "Hair & beauty",
    googleTypes: ["hair_salon", "hair_care", "barber_shop", "beauty_salon", "nail_salon", "beautician", "makeup_artist"]
  },
  laundry: {
    label: "Laundry",
    googleTypes: ["laundry"]
  },
  banks: {
    label: "Banks",
    googleTypes: ["bank"]
  },
  atm: {
    label: "ATM",
    googleTypes: ["atm"]
  },
  post_office: {
    label: "Post office",
    googleTypes: ["post_office"]
  },
  shipping_courier: {
    label: "Shipping & courier",
    googleTypes: ["shipping_service", "courier_service"]
  },
  car_repair_tyres: {
    label: "Car repair & tyres",
    googleTypes: ["car_repair", "tire_shop"]
  },
  car_wash: {
    label: "Car wash",
    googleTypes: ["car_wash"]
  },
  veterinary: {
    label: "Veterinary",
    googleTypes: ["veterinary_care"]
  },
  pet_care: {
    label: "Pet care",
    googleTypes: ["pet_care", "pet_boarding_service"]
  },
  pet_stores: {
    label: "Pet stores",
    googleTypes: ["pet_store"]
  }
});

const LOCATION_DETAILS_TYPE_MAP = Object.freeze({
  poi: 'pois',
  address: 'addresses',
  street: 'streets',
  intersection: 'intersections',
  area: 'areas'
});

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function emptyUsage() {
  return {
    month: monthKey(),

    // Active counters.
    tomtomRoute: 0,
    tomtomSuggest: 0,
    tomtomDetails: 0,
    googleNearbyPro: 0,
    googleNearbyEnterprise: 0,

    // Historical counters preserved so replacing server.js does not hide prior use.
    tomtomSearch: 0,
    googleTextSearchPro: 0
  };
}

function ensureUsageDir() {
  fs.mkdirSync(USAGE_DIR, { recursive: true });
}

function loadUsage() {
  ensureUsageDir();
  try {
    if (!fs.existsSync(USAGE_FILE)) return emptyUsage();
    const parsed = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    if (parsed.month !== monthKey()) return emptyUsage();
    return { ...emptyUsage(), ...parsed };
  } catch {
    return emptyUsage();
  }
}

function saveUsage(usage) {
  ensureUsageDir();
  const temp = `${USAGE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(usage, null, 2), 'utf8');
  fs.renameSync(temp, USAGE_FILE);
}

let usageLock = Promise.resolve();

async function reserveUsage(kind) {
  usageLock = usageLock.then(async () => {
    const usage = loadUsage();
    const cap = MONTHLY_LIMITS[kind];
    if (!cap) throw codedError('INTERNAL_USAGE_KIND', 500);
    if (Number(usage[kind] || 0) >= cap) {
      throw codedError('API_TEST_BUDGET_EXHAUSTED', 429);
    }
    usage[kind] = Number(usage[kind] || 0) + 1;
    saveUsage(usage);
  });
  return usageLock;
}

function codedError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function cleanString(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function humanizeType(type) {
  const value = cleanString(type);
  if (!value) return null;
  return value
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function validateCategoryConfigAtStartup() {
  const ids = Object.keys(CATEGORY_CONFIG);
  if (ids.length !== 52) throw new Error(`CATEGORY_CONFIG_COUNT_${ids.length}`);

  for (const [id, config] of Object.entries(CATEGORY_CONFIG)) {
    if (!cleanString(config.label)) throw new Error(`CATEGORY_LABEL_MISSING_${id}`);
    if (!Array.isArray(config.googleTypes) || config.googleTypes.length < 1) {
      throw new Error(`CATEGORY_GOOGLE_TYPES_MISSING_${id}`);
    }
    if (config.googleTypes.length > 50) {
      throw new Error(`CATEGORY_GOOGLE_TYPES_OVER_50_${id}`);
    }
    if (new Set(config.googleTypes).size !== config.googleTypes.length) {
      throw new Error(`CATEGORY_GOOGLE_TYPES_DUPLICATE_${id}`);
    }
    for (const type of config.googleTypes) {
      if (!/^[a-z0-9_]+$/.test(type)) {
        throw new Error(`CATEGORY_GOOGLE_TYPE_INVALID_${id}_${type}`);
      }
    }
  }
}

validateCategoryConfigAtStartup();

async function fetchJson(url, options, source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw codedError(`${source.toUpperCase().replace(/\s+/g, '_')}_INVALID_JSON`, 502);
    }

    if (!response.ok) {
      const err = codedError(
        `${source.toUpperCase().replace(/\s+/g, '_')}_HTTP_${response.status}`,
        502
      );
      err.providerBody = text.slice(0, 1000);
      throw err;
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

function validateSearchInput(body) {
  const latitude = numberOrNull(body?.latitude);
  const longitude = numberOrNull(body?.longitude);
  const category = cleanString(body?.category);
  const maxWalkMinutes = numberOrNull(body?.maxWalkMinutes) ?? 15;
  const openNowOnly = Boolean(body?.openNowOnly);

  if (latitude === null || latitude < -90 || latitude > 90) {
    throw codedError('INVALID_LOCATION');
  }
  if (longitude === null || longitude < -180 || longitude > 180) {
    throw codedError('INVALID_LOCATION');
  }
  if (!category || !CATEGORY_CONFIG[category]) {
    throw codedError('INVALID_CATEGORY');
  }
  if (maxWalkMinutes < 5 || maxWalkMinutes > 30) {
    throw codedError('INVALID_WALK_LIMIT');
  }

  return {
    latitude,
    longitude,
    category,
    maxWalkMinutes: Math.round(maxWalkMinutes),
    openNowOnly
  };
}

function googleNearbyFieldMask(openNowOnly) {
  const fields = [
    'places.id',
    'places.displayName',
    'places.location',
    'places.formattedAddress',
    'places.businessStatus',
    'places.movedPlaceId',
    'places.primaryType',
    'places.primaryTypeDisplayName',
    'places.types'
  ];

  if (openNowOnly) {
    fields.push('places.currentOpeningHours');
  }

  return fields.join(',');
}

function googleCategoryMatches(config, place) {
  const returnedTypes = Array.isArray(place?.types)
    ? place.types.filter(v => typeof v === 'string')
    : [];

  return config.googleTypes.some(type => returnedTypes.includes(type));
}

function normalizeGoogleNearbyPlace(place, config, openNowOnly) {
  const id = cleanString(place?.id);
  const name = cleanString(place?.displayName?.text);
  const latitude = numberOrNull(place?.location?.latitude);
  const longitude = numberOrNull(place?.location?.longitude);
  const businessStatus = cleanString(place?.businessStatus);
  const movedPlaceId = cleanString(place?.movedPlaceId);
  const primaryType = cleanString(place?.primaryType);
  const returnedTypes = Array.isArray(place?.types)
    ? place.types.filter(v => typeof v === 'string' && v.trim())
    : [];

  if (!id || !name || latitude === null || longitude === null) return null;

  // Freshness/existence gates.
  if (businessStatus !== 'OPERATIONAL') return null;
  if (movedPlaceId) return null;

  // Category must still be source-backed on the individual Google result.
  if (!googleCategoryMatches(config, place)) return null;

  let isOpenNow = null;
  if (openNowOnly) {
    if (place?.currentOpeningHours?.openNow !== true) return null;
    isOpenNow = true;
  }

  const sourceLabel =
    cleanString(place?.primaryTypeDisplayName?.text) ||
    humanizeType(primaryType);

  if (!sourceLabel) return null;

  return {
    id,
    name,
    categoryLabel: sourceLabel,
    sourceCategories: returnedTypes,
    primaryType,
    latitude,
    longitude,
    address: cleanString(place?.formattedAddress) || '',
    isOpenNow
  };
}

async function searchGoogleNearby({
  latitude,
  longitude,
  config,
  maxWalkMinutes,
  openNowOnly,
  perSearch
}) {
  if (perSearch.googleCalls >= GOOGLE_CALLS_PER_SEARCH_CAP) {
    throw codedError('SEARCH_COST_CAP_REACHED', 429);
  }

  const usageKind = openNowOnly ? 'googleNearbyEnterprise' : 'googleNearbyPro';
  await reserveUsage(usageKind);

  perSearch.googleCalls += 1;
  perSearch[usageKind] += 1;

  /*
   * Generous straight-line search radius. Actual max walking time is enforced
   * later using TomTom pedestrian routing.
   */
  const radius = Math.min(6000, Math.max(1000, Math.round(maxWalkMinutes * 125)));

  const body = {
    includedTypes: config.googleTypes,
    maxResultCount: GOOGLE_NEARBY_CANDIDATE_LIMIT,
    rankPreference: 'DISTANCE',
    languageCode: 'nb',
    regionCode: 'NO',
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius
      }
    }
  };

  const json = await fetchJson(
    'https://places.googleapis.com/v1/places:searchNearby',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': googleNearbyFieldMask(openNowOnly)
      },
      body: JSON.stringify(body)
    },
    'Google Nearby Search'
  );

  const raw = Array.isArray(json?.places) ? json.places : [];
  return raw
    .map(place => normalizeGoogleNearbyPlace(place, config, openNowOnly))
    .filter(Boolean);
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function paceTomTomRoute(perSearch) {
  const now = Date.now();
  const last = numberOrNull(perSearch.lastTomTomRouteStartedAtMs);

  if (last !== null) {
    const waitMs = TOMTOM_ROUTE_MIN_INTERVAL_MS - (now - last);
    if (waitMs > 0) await sleepMs(waitMs);
  }

  perSearch.lastTomTomRouteStartedAtMs = Date.now();
}

async function getPedestrianRoute({
  fromLat,
  fromLon,
  toLat,
  toLon,
  perSearch
}) {
  if (perSearch.tomtomRoute >= TOMTOM_ROUTE_CALLS_PER_SEARCH_CAP) {
    throw codedError('SEARCH_COST_CAP_REACHED', 429);
  }

  await paceTomTomRoute(perSearch);

  perSearch.tomtomRoute += 1;
  await reserveUsage('tomtomRoute');

  const locations = `${fromLat},${fromLon}:${toLat},${toLon}`;
  const url = new URL(
    `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json`
  );
  url.searchParams.set('key', TOMTOM_API_KEY);
  url.searchParams.set('travelMode', 'pedestrian');
  url.searchParams.set('routeType', 'fastest');
  url.searchParams.set('traffic', 'false');

  const json = await fetchJson(url, { method: 'GET' }, 'TomTom Routing');
  const summary = json?.routes?.[0]?.summary;
  const walkSeconds = numberOrNull(summary?.travelTimeInSeconds);
  const walkDistanceMeters = numberOrNull(summary?.lengthInMeters);

  if (walkSeconds === null || walkDistanceMeters === null) return null;

  return {
    walkSeconds: Math.round(walkSeconds),
    walkMinutes: Math.max(1, Math.ceil(walkSeconds / 60)),
    walkDistanceMeters: Math.round(walkDistanceMeters)
  };
}

async function executeGoogleDiagnostic(input) {
  if (!GOOGLE_PLACES_API_KEY) {
    throw codedError('MISSING_GOOGLE_PLACES_API_KEY', 503);
  }

  const config = CATEGORY_CONFIG[input.category];
  const perSearch = {
    googleCalls: 0,
    googleNearbyPro: 0,
    googleNearbyEnterprise: 0,
    tomtomRoute: 0
  };

  const places = await searchGoogleNearby({
    latitude: input.latitude,
    longitude: input.longitude,
    config,
    maxWalkMinutes: input.maxWalkMinutes,
    openNowOnly: input.openNowOnly,
    perSearch
  });

  return {
    diagnostic: 'GOOGLE_NEARBY_ONLY_NO_ROUTING',
    buildId: BUILD_ID,
    category: input.category,
    includedTypes: config.googleTypes,
    openNowOnly: input.openNowOnly,
    returned: places.length,
    usageThisDiagnostic: {
      googleNearbyPro: perSearch.googleNearbyPro,
      googleNearbyEnterprise: perSearch.googleNearbyEnterprise
    },
    places
  };
}

async function executeSearch(input) {
  if (!TOMTOM_API_KEY) {
    throw codedError('MISSING_TOMTOM_API_KEY', 503);
  }
  if (!GOOGLE_PLACES_API_KEY) {
    throw codedError('MISSING_GOOGLE_PLACES_API_KEY', 503);
  }

  const config = CATEGORY_CONFIG[input.category];
  const perSearch = {
    googleCalls: 0,
    googleNearbyPro: 0,
    googleNearbyEnterprise: 0,
    tomtomRoute: 0,
    lastTomTomRouteStartedAtMs: null
  };

  /*
   * ONE Google Nearby Search call performs:
   * - category discovery
   * - business-status freshness gate
   * - moved-place rejection
   * - open-now gate when selected
   */
  const candidates = await searchGoogleNearby({
    latitude: input.latitude,
    longitude: input.longitude,
    config,
    maxWalkMinutes: input.maxWalkMinutes,
    openNowOnly: input.openNowOnly,
    perSearch
  });

  const routed = [];

  for (const candidate of candidates.slice(0, ROUTE_CANDIDATE_LIMIT)) {
    const route = await getPedestrianRoute({
      fromLat: input.latitude,
      fromLon: input.longitude,
      toLat: candidate.latitude,
      toLon: candidate.longitude,
      perSearch
    });

    if (!route) continue;
    if (route.walkMinutes > input.maxWalkMinutes) continue;

    routed.push({
      id: candidate.id,
      name: candidate.name,
      categoryLabel: candidate.categoryLabel,
      sourceCategories: candidate.sourceCategories,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      address: candidate.address,
      isOpenNow: candidate.isOpenNow,
      googleOperationalVerified: true,
      walkSeconds: route.walkSeconds,
      walkMinutes: route.walkMinutes,
      walkDistanceMeters: route.walkDistanceMeters
    });
  }

  routed.sort((a, b) =>
    a.walkSeconds - b.walkSeconds ||
    a.walkDistanceMeters - b.walkDistanceMeters
  );

  const places = routed.slice(0, RESULT_LIMIT);
  const usage = loadUsage();

  return {
    summary: {
      requested: RESULT_LIMIT,
      returned: places.length,
      exhaustedCandidates: places.length < RESULT_LIMIT,
      sortedBy: 'ACTUAL_PEDESTRIAN_TRAVEL_TIME',
      discoverySource: 'GOOGLE_NEARBY_SEARCH_NEW',
      freshnessGate: 'GOOGLE_BUSINESS_STATUS_AND_MOVED_PLACE',
      categoryGate: 'GOOGLE_INCLUDED_TYPES_PLUS_RESULT_TYPES',
      openNowGate: input.openNowOnly
        ? 'GOOGLE_CURRENT_OPENING_HOURS'
        : 'OFF'
    },
    usage: {
      thisSearch: {
        googleNearbyPro: perSearch.googleNearbyPro,
        googleNearbyEnterprise: perSearch.googleNearbyEnterprise,
        tomtomRoute: perSearch.tomtomRoute
      },
      month: usage,
      hardLimits: MONTHLY_LIMITS,
      hardPerSearchLimits: {
        googleNearbyCalls: GOOGLE_CALLS_PER_SEARCH_CAP,
        tomtomRoute: TOMTOM_ROUTE_CALLS_PER_SEARCH_CAP
      }
    },
    places
  };
}

async function suggestLocations(body) {
  if (!TOMTOM_API_KEY) throw codedError('MISSING_TOMTOM_API_KEY', 503);

  const query = cleanString(body?.query);
  if (!query || query.length < 3) return { suggestions: [] };

  await reserveUsage('tomtomSuggest');

  const latitude = numberOrNull(body?.latitude) ?? 59.9110;
  const longitude = numberOrNull(body?.longitude) ?? 10.7522;

  const requestBody = {
    query,
    maxResults: 5,
    filters: {
      types: ['poi', 'address', 'street', 'intersection', 'area']
    },
    preferences: {
      geometry: {
        type: 'point',
        coordinates: [longitude, latitude]
      }
    }
  };

  const json = await fetchJson(
    'https://api.tomtom.com/maps/orbis/places/suggest',
    {
      method: 'POST',
      headers: {
        'TomTom-Api-Key': TOMTOM_API_KEY,
        'TomTom-Api-Version': '3',
        'Attributes': 'results',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    },
    'TomTom Suggest'
  );

  const suggestions = (Array.isArray(json?.results) ? json.results : [])
    .map(item => {
      const id = cleanString(item?.id);
      const type = cleanString(item?.type);
      const title = cleanString(item?.title);

      if (!id || !type || !title || !LOCATION_DETAILS_TYPE_MAP[type]) {
        return null;
      }

      return {
        id,
        type,
        title,
        subtitle: Array.isArray(item?.subtitles)
          ? item.subtitles
              .filter(v => typeof v === 'string')
              .join(', ')
          : ''
      };
    })
    .filter(Boolean);

  return { suggestions };
}

async function resolveSuggestedLocation(body) {
  if (!TOMTOM_API_KEY) throw codedError('MISSING_TOMTOM_API_KEY', 503);

  const id = cleanString(body?.id);
  const type = cleanString(body?.type);
  const detailsType = type ? LOCATION_DETAILS_TYPE_MAP[type] : null;

  if (!id || !type || !detailsType) {
    throw codedError('INVALID_LOCATION_SELECTION');
  }

  await reserveUsage('tomtomDetails');

  const url =
    `https://api.tomtom.com/maps/orbis/places/details/` +
    `${encodeURIComponent(detailsType)}/${encodeURIComponent(id)}`;

  const json = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        'TomTom-Api-Key': TOMTOM_API_KEY,
        'TomTom-Api-Version': '3',
        'Attributes': 'id,type,title,subtitles,position,address',
        'Accept': 'application/json'
      }
    },
    'TomTom Details'
  );

  const coordinates = json?.position?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw codedError('LOCATION_HAS_NO_COORDINATES', 502);
  }

  const longitude = numberOrNull(coordinates[0]);
  const latitude = numberOrNull(coordinates[1]);

  if (latitude === null || longitude === null) {
    throw codedError('LOCATION_HAS_NO_COORDINATES', 502);
  }

  const addressObj = json?.address;
  let address = '';

  if (typeof addressObj === 'string') {
    address = addressObj;
  } else if (addressObj && typeof addressObj === 'object') {
    address = [
      [
        cleanString(addressObj.street),
        cleanString(addressObj.houseNumber)
      ].filter(Boolean).join(' '),
      [
        cleanString(addressObj.postalCode),
        cleanString(addressObj.municipality || addressObj.city)
      ].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');
  }

  return {
    id,
    type,
    title: cleanString(json?.title) || 'Selected location',
    address,
    latitude,
    longitude
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(codedError('REQUEST_TOO_LARGE', 413));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(codedError('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleHttp(req, res) {
  try {
    const url = new URL(
      req.url,
      `http://${req.headers.host || '127.0.0.1'}`
    );

    if (req.method === 'GET' && url.pathname === '/status') {
      return sendJson(res, 200, {
        ok: true,
        buildId: BUILD_ID,
        service: 'NearTime backend',
        placeDiscovery: 'Google Places Nearby Search (New)',
        pedestrianRouting: 'TomTom Routing API',
        categoryCount: Object.keys(CATEGORY_CONFIG).length,
        targetResults: RESULT_LIMIT,
        googleNearbyMaxCandidates: GOOGLE_NEARBY_CANDIDATE_LIMIT,
        routingMinIntervalMs: TOMTOM_ROUTE_MIN_INTERVAL_MS,
        googleDiagnosticEndpoint: '/debug/google',
        hardRules: {
          googlePaidCallsPerExplicitSearch: GOOGLE_CALLS_PER_SEARCH_CAP,
          noGoogleOnStartupTypingGpsFilterOrMapMovement: true,
          failClosedOnClosedMovedOrUnverifiedPlace: true,
          failClosedOnMissingOpenNowWhenFilterEnabled: true,
          sourceBackedLabelsOnly: true,
          noResultPadding: true
        },
        activeMonthlyUsage: {
          tomtomRoute: loadUsage().tomtomRoute,
          tomtomSuggest: loadUsage().tomtomSuggest,
          tomtomDetails: loadUsage().tomtomDetails,
          googleNearbyPro: loadUsage().googleNearbyPro,
          googleNearbyEnterprise: loadUsage().googleNearbyEnterprise
        },
        historicalUsagePreserved: {
          tomtomSearch: loadUsage().tomtomSearch,
          googleTextSearchPro: loadUsage().googleTextSearchPro
        },
        monthlyLimits: MONTHLY_LIMITS
      });
    }

    if (req.method === 'POST' && url.pathname === '/debug/google') {
      const body = await readJsonBody(req);
      const input = validateSearchInput(body);
      const result = await executeGoogleDiagnostic(input);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/spike/search') {
      const body = await readJsonBody(req);
      const input = validateSearchInput(body);
      const result = await executeSearch(input);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/location/suggest') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await suggestLocations(body));
    }

    if (req.method === 'POST' && url.pathname === '/location/resolve') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, await resolveSuggestedLocation(body));
    }

    return sendJson(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    const status = Number(error?.status) || 500;
    const code =
      cleanString(error?.code) ||
      cleanString(error?.message) ||
      'INTERNAL_ERROR';

    // Provider body is deliberately not sent to the app; it may contain
    // implementation details. It remains available to debugger/logging code.
    return sendJson(res, status, { error: code });
  }
}

function startServer() {
  if (!TOMTOM_API_KEY) {
    console.error('FATAL: TOMTOM_API_KEY missing');
    process.exit(1);
  }
  if (!GOOGLE_PLACES_API_KEY) {
    console.error('FATAL: GOOGLE_PLACES_API_KEY missing');
    process.exit(1);
  }

  const server = http.createServer(handleHttp);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`NearTime backend listening on 0.0.0.0:${PORT}`);
    console.log(`Build: ${BUILD_ID}`);
    console.log(`Categories: ${Object.keys(CATEGORY_CONFIG).length}`);
    console.log('Place discovery: Google Places Nearby Search (New)');
    console.log('Pedestrian routing: TomTom Routing API');
    console.log('Google calls per explicit place search: max 1');
    console.log('Google calls on startup/typing/GPS/filter/map movement: 0');
  });

  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}

export {
  CATEGORY_CONFIG,
  MONTHLY_LIMITS,
  HARD_MAX,
  RESULT_LIMIT,
  validateCategoryConfigAtStartup,
  validateSearchInput,
  googleNearbyFieldMask,
  googleCategoryMatches,
  normalizeGoogleNearbyPlace,
  searchGoogleNearby,
  getPedestrianRoute,
  executeGoogleDiagnostic,
  executeSearch,
  suggestLocations,
  resolveSuggestedLocation,
  handleHttp,
  startServer
};

export const _test = {
  emptyUsage,
  loadUsage,
  saveUsage,
  humanizeType
};
