#!/usr/bin/env node
/**
 * NearTime backend — cost-gated search.
 * Normal explicit search: <=1 TomTom Discover request, 0 Google Places,
 * 0 paid routing requests, <=1 self-hosted Valhalla walking matrix.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = clampInt(process.env.PORT, 1, 65535, 8081);
const TOMTOM_API_KEY = String(process.env.TOMTOM_API_KEY || '').trim();
const VALHALLA_BASE_URL = String(process.env.VALHALLA_BASE_URL || 'http://127.0.0.1:8002').replace(/\/+$/, '');
const BUILD_ID = '2026-09-18-discover-valhalla-v1';
const RESULT_LIMIT = 10;
const DISCOVER_CANDIDATE_LIMIT = 40;
const TOMTOM_DISCOVER_CALLS_PER_SEARCH_CAP = 1;
const VALHALLA_MATRIX_CALLS_PER_SEARCH_CAP = 1;
const HTTP_TIMEOUT_MS = 15000;

const CATEGORY_IDS = [
  'cafes_coffee','restaurants','fast_food_takeaway','bars_drinks','bakeries_sweets',
  'groceries_supermarkets','clothing_fashion','electronics','home_furniture',
  'shopping_centres','other_shops','pharmacy','doctor_clinic','dentist','hospital',
  'spa_wellness','gym_fitness','swimming','sports_facilities','golf','parking',
  'public_transport','train_stations','bus_stations_stops','fuel_stations','ev_charging',
  'airports','schools','preschool','universities','libraries','parks','outdoor_activities',
  'museums_galleries','cinema','entertainment','attractions','playgrounds','hotels',
  'hostels_guest_houses','camping','hair_beauty','laundry','banks','atm','post_office',
  'shipping_courier','car_repair_tyres','car_wash','veterinary','pet_care','pet_stores'
];

const QUERY_OVERRIDES = Object.freeze({
  cafes_coffee: 'cafe coffee',
  fast_food_takeaway: 'fast food takeaway',
  bars_drinks: 'bar pub',
  bakeries_sweets: 'bakery dessert',
  groceries_supermarkets: 'supermarket grocery',
  home_furniture: 'furniture home goods',
  shopping_centres: 'shopping centre mall',
  other_shops: 'shop store',
  doctor_clinic: 'doctor clinic',
  spa_wellness: 'spa wellness',
  gym_fitness: 'gym fitness',
  swimming: 'swimming pool',
  sports_facilities: 'sports facility',
  public_transport: 'public transport station',
  train_stations: 'train station',
  bus_stations_stops: 'bus stop',
  fuel_stations: 'fuel station gas station',
  ev_charging: 'EV charging',
  outdoor_activities: 'outdoor activity hiking',
  museums_galleries: 'museum gallery',
  cinema: 'cinema movie theater',
  attractions: 'tourist attraction',
  hostels_guest_houses: 'hostel guest house',
  hair_beauty: 'hair salon beauty',
  shipping_courier: 'courier shipping',
  car_repair_tyres: 'car repair tyre tire',
  veterinary: 'veterinary vet'
});

function humanize(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
    .join(' ');
}

const CATEGORY_CONFIG = Object.freeze(Object.fromEntries(
  CATEGORY_IDS.map(function (id) {
    return [id, {
      label: humanize(id),
      query: QUERY_OVERRIDES[id] || id.replace(/_/g, ' ')
    }];
  })
));

const LOCATION_DETAILS_TYPE_MAP = Object.freeze({
  poi: 'pois',
  address: 'addresses',
  street: 'streets',
  intersection: 'intersections',
  area: 'areas'
});

const HARD_MAX = Object.freeze({
  tomtomDiscover: 900,
  tomtomSuggest: 300,
  tomtomDetails: 300
});

const MONTHLY_LIMITS = Object.freeze({
  tomtomDiscover: clampInt(process.env.TOMTOM_DISCOVER_MONTHLY_CAP, 1, HARD_MAX.tomtomDiscover, HARD_MAX.tomtomDiscover),
  tomtomSuggest: clampInt(process.env.TOMTOM_SUGGEST_MONTHLY_CAP, 1, HARD_MAX.tomtomSuggest, HARD_MAX.tomtomSuggest),
  tomtomDetails: clampInt(process.env.TOMTOM_DETAILS_MONTHLY_CAP, 1, HARD_MAX.tomtomDetails, HARD_MAX.tomtomDetails)
});

const USAGE_DIR = path.resolve(process.env.USAGE_DIR || path.join(__dirname, '.usage'));
const USAGE_FILE = path.join(USAGE_DIR, 'api-usage.json');

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function codedError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status || 400;
  return error;
}

function monthKey() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function emptyUsage() {
  return {
    month: monthKey(),
    tomtomDiscover: 0,
    tomtomSuggest: 0,
    tomtomDetails: 0,
    valhallaMatrix: 0,
    tomtomRoute: 0,
    googleNearbyPro: 0,
    googleNearbyEnterprise: 0,
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
    return Object.assign(emptyUsage(), parsed);
  } catch {
    return emptyUsage();
  }
}

function saveUsage(usage) {
  ensureUsageDir();
  const temp = USAGE_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(usage, null, 2), 'utf8');
  fs.renameSync(temp, USAGE_FILE);
}

let usageLock = Promise.resolve();

async function reserveUsage(kind) {
  usageLock = usageLock.then(async function () {
    const usage = loadUsage();
    const cap = MONTHLY_LIMITS[kind];
    if (!cap) throw codedError('INTERNAL_USAGE_KIND', 500);
    if (Number(usage[kind] || 0) >= cap) throw codedError('API_TEST_BUDGET_EXHAUSTED', 429);
    usage[kind] = Number(usage[kind] || 0) + 1;
    saveUsage(usage);
  });
  return usageLock;
}

async function recordMatrixUsage() {
  usageLock = usageLock.then(async function () {
    const usage = loadUsage();
    usage.valhallaMatrix = Number(usage.valhallaMatrix || 0) + 1;
    saveUsage(usage);
  });
  return usageLock;
}

function validateCategoryConfigAtStartup() {
  if (Object.keys(CATEGORY_CONFIG).length !== 52) throw new Error('CATEGORY_CONFIG_COUNT');
  for (const [id, config] of Object.entries(CATEGORY_CONFIG)) {
    if (!cleanString(config.label)) throw new Error('CATEGORY_LABEL_MISSING_' + id);
    if (!cleanString(config.query)) throw new Error('CATEGORY_QUERY_MISSING_' + id);
  }
}

validateCategoryConfigAtStartup();

function validateSearchInput(body) {
  const latitude = numberOrNull(body && body.latitude);
  const longitude = numberOrNull(body && body.longitude);
  const category = cleanString(body && body.category);
  const maxWalkMinutes = numberOrNull(body && body.maxWalkMinutes) ?? 15;
  const openNowOnly = Boolean(body && body.openNowOnly);

  if (latitude === null || latitude < -90 || latitude > 90) throw codedError('INVALID_LOCATION');
  if (longitude === null || longitude < -180 || longitude > 180) throw codedError('INVALID_LOCATION');
  if (!category || !CATEGORY_CONFIG[category]) throw codedError('INVALID_CATEGORY');
  if (maxWalkMinutes < 5 || maxWalkMinutes > 30) throw codedError('INVALID_WALK_LIMIT');

  return {
    latitude: latitude,
    longitude: longitude,
    category: category,
    maxWalkMinutes: Math.round(maxWalkMinutes),
    openNowOnly: openNowOnly
  };
}

async function fetchJson(url, options, source) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw codedError(source.toUpperCase().replace(/\s+/g, '_') + '_INVALID_JSON', 502);
    }
    if (!response.ok) {
      const status = source === 'Local Valhalla' ? 503 : 502;
      throw codedError(source.toUpperCase().replace(/\s+/g, '_') + '_HTTP_' + response.status, status);
    }
    return json;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw codedError(source === 'Local Valhalla' ? 'LOCAL_VALHALLA_TIMEOUT' : source.toUpperCase().replace(/\s+/g, '_') + '_TIMEOUT', source === 'Local Valhalla' ? 503 : 502);
    }
    if (source === 'Local Valhalla' && !(error && error.status)) throw codedError('LOCAL_VALHALLA_UNAVAILABLE', 503);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function discoverAttributes(openNowOnly) {
  const fields = [
    'id',
    'type',
    'title',
    'position.coordinates',
    'subtitles',
    'address(street,houseNumber,postalCode,municipality,municipalitySubdivision)',
    'poiTypes(id,name)'
  ];
  if (openNowOnly) fields.push('openingHours(date,timeRanges(start,end,utcOffsetSeconds))');
  return 'results(' + fields.join(',') + ')';
}

function tomtomAddress(item) {
  const address = item && item.address;
  if (typeof address === 'string') return address.trim();
  if (address && typeof address === 'object') {
    const street = [cleanString(address.street), cleanString(address.houseNumber)].filter(Boolean).join(' ');
    const city = [cleanString(address.postalCode), cleanString(address.municipality || address.municipalitySubdivision)].filter(Boolean).join(' ');
    const combined = [street, city].filter(Boolean).join(', ');
    if (combined) return combined;
  }
  if (Array.isArray(item && item.subtitles)) return item.subtitles.filter(function (v) { return typeof v === 'string' && v.trim(); }).join(', ');
  return '';
}

function wallClockToUtc(dateValue, timeValue, offsetSeconds) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue || ''));
  const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeValue || ''));
  const offset = numberOrNull(offsetSeconds);
  if (!date || !time || offset === null) return null;
  const hour = Number(time[1]);
  const extraDays = Math.floor(hour / 24);
  return Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]) + extraDays, hour % 24, Number(time[2]), Number(time[3] || 0)) - offset * 1000;
}

function isOpenAtEpoch(openingHours, nowMs) {
  const now = nowMs === undefined ? Date.now() : nowMs;
  const rows = Array.isArray(openingHours) ? openingHours : [];
  for (const row of rows) {
    const date = cleanString(row && row.date);
    const ranges = Array.isArray(row && row.timeRanges) ? row.timeRanges : [];
    if (!date) continue;
    for (const range of ranges) {
      const offset = numberOrNull(range && range.utcOffsetSeconds) ?? numberOrNull(row && row.utcOffsetSeconds);
      const start = wallClockToUtc(date, range && range.start, offset);
      const end = wallClockToUtc(date, range && range.end, offset);
      if (start !== null && end !== null && now >= start && now < end) return true;
    }
  }
  return false;
}

function normalizeTomTomPlace(item, config, openNowOnly, nowMs) {
  if (cleanString(item && item.type) !== 'poi') return null;
  const id = cleanString(item && item.id);
  const name = cleanString(item && item.title);
  const coordinates = item && item.position && item.position.coordinates;
  if (!id || !name || !Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = numberOrNull(coordinates[0]);
  const latitude = numberOrNull(coordinates[1]);
  if (latitude === null || longitude === null) return null;

  const poiTypes = Array.isArray(item && item.poiTypes) ? item.poiTypes : [];
  const sourceCategories = poiTypes.map(function (v) { return cleanString(v && v.id) || cleanString(v && v.name); }).filter(Boolean);
  if (sourceCategories.length === 0) sourceCategories.push(config.query);
  const categoryLabel = poiTypes.map(function (v) { return cleanString(v && v.name); }).find(Boolean) || config.label;

  let isOpenNow = null;
  if (openNowOnly) {
    const hours = Array.isArray(item && item.openingHours) ? item.openingHours : [];
    if (hours.length === 0) return null;
    isOpenNow = isOpenAtEpoch(hours, nowMs);
    if (isOpenNow !== true) return null;
  }

  return {
    id: id,
    name: name,
    categoryLabel: categoryLabel,
    sourceCategories: sourceCategories,
    latitude: latitude,
    longitude: longitude,
    address: tomtomAddress(item),
    isOpenNow: isOpenNow,
    sourceVerified: true,
    googleOperationalVerified: true
  };
}

function straightLineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = function (v) { return v * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

async function searchTomTomDiscover(input, config, perSearch) {
  if (perSearch.tomtomDiscover >= TOMTOM_DISCOVER_CALLS_PER_SEARCH_CAP) throw codedError('SEARCH_COST_CAP_REACHED', 429);
  await reserveUsage('tomtomDiscover');
  perSearch.tomtomDiscover += 1;

  const radiusMeters = Math.min(6000, Math.max(1200, Math.round(input.maxWalkMinutes * 180)));
  const body = {
    query: config.query,
    origin: { type: 'point', coordinates: [input.longitude, input.latitude] },
    maxResults: DISCOVER_CANDIDATE_LIMIT,
    filters: {
      types: ['poi'],
      geometry: { type: 'circle', center: [input.longitude, input.latitude], radiusInMeters: radiusMeters }
    },
    preferences: { geometry: { type: 'point', coordinates: [input.longitude, input.latitude] } }
  };
  const sessionId = randomUUID();
  const json = await fetchJson(
    'https://api.tomtom.com/maps/orbis/places/discover',
    {
      method: 'POST',
      headers: {
        'TomTom-Api-Key': TOMTOM_API_KEY,
        'TomTom-Api-Version': '3',
        'Tracking-Id': randomUUID(),
        'Session-Id': sessionId,
        'Attributes': discoverAttributes(input.openNowOnly),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.7'
      },
      body: JSON.stringify(body)
    },
    'TomTom Discover'
  );
  const raw = Array.isArray(json && json.results) ? json.results : [];
  return raw
    .map(function (item) { return normalizeTomTomPlace(item, config, input.openNowOnly); })
    .filter(Boolean)
    .filter(function (place) {
      return straightLineDistanceMeters(input.latitude, input.longitude, place.latitude, place.longitude) <= radiusMeters;
    });
}

function extractMatrixRow(json) {
  const matrix = json && json.sources_to_targets;
  if (Array.isArray(matrix) && matrix.length > 0 && Array.isArray(matrix[0])) return matrix[0];
  return Array.isArray(matrix) ? matrix : [];
}

async function getWalkingMatrix(input, candidates, perSearch) {
  if (candidates.length === 0) return [];
  if (perSearch.valhallaMatrix >= VALHALLA_MATRIX_CALLS_PER_SEARCH_CAP) throw codedError('SEARCH_COST_CAP_REACHED', 429);
  perSearch.valhallaMatrix += 1;
  await recordMatrixUsage();

  const payload = {
    sources: [{ lat: input.latitude, lon: input.longitude }],
    targets: candidates.map(function (place) { return { lat: place.latitude, lon: place.longitude }; }),
    costing: 'pedestrian',
    units: 'kilometers',
    verbose: true
  };
  const url = new URL(VALHALLA_BASE_URL + '/sources_to_targets');
  url.searchParams.set('json', JSON.stringify(payload));
  const json = await fetchJson(url, { method: 'GET' }, 'Local Valhalla');
  const row = extractMatrixRow(json);

  return candidates.map(function (candidate, index) {
    const entry = row[index];
    const seconds = numberOrNull(entry && entry.time);
    const distanceKm = numberOrNull(entry && entry.distance);
    if (seconds === null || distanceKm === null || seconds < 0 || distanceKm < 0) return null;
    return {
      candidate: candidate,
      walkSeconds: Math.round(seconds),
      walkMinutes: Math.max(1, Math.ceil(seconds / 60)),
      walkDistanceMeters: Math.round(distanceKm * 1000)
    };
  });
}

async function executeSearch(input) {
  if (!TOMTOM_API_KEY) throw codedError('MISSING_TOMTOM_API_KEY', 503);
  const perSearch = { tomtomDiscover: 0, valhallaMatrix: 0 };
  const config = CATEGORY_CONFIG[input.category];
  const candidates = await searchTomTomDiscover(input, config, perSearch);
  const matrix = await getWalkingMatrix(input, candidates, perSearch);

  const places = matrix
    .filter(Boolean)
    .filter(function (item) { return item.walkMinutes <= input.maxWalkMinutes; })
    .map(function (item) {
      return Object.assign({}, item.candidate, {
        walkSeconds: item.walkSeconds,
        walkMinutes: item.walkMinutes,
        walkDistanceMeters: item.walkDistanceMeters
      });
    })
    .sort(function (a, b) { return a.walkSeconds - b.walkSeconds || a.walkDistanceMeters - b.walkDistanceMeters; })
    .slice(0, RESULT_LIMIT);

  return {
    summary: {
      requested: RESULT_LIMIT,
      returned: places.length,
      exhaustedCandidates: places.length < RESULT_LIMIT,
      sortedBy: 'ACTUAL_PEDESTRIAN_TRAVEL_TIME',
      discoverySource: 'TOMTOM_ORBIS_PLACES_DISCOVER',
      routingSource: 'SELF_HOSTED_VALHALLA_MATRIX',
      openNowGate: input.openNowOnly ? 'TOMTOM_OPENING_HOURS_FAIL_CLOSED' : 'OFF'
    },
    usage: {
      thisSearch: {
        tomtomDiscover: perSearch.tomtomDiscover,
        valhallaMatrix: perSearch.valhallaMatrix,
        googlePlaces: 0,
        tomtomRoute: 0
      }
    },
    places: places
  };
}

async function suggestLocations(body) {
  if (!TOMTOM_API_KEY) throw codedError('MISSING_TOMTOM_API_KEY', 503);
  const query = cleanString(body && body.query);
  if (!query || query.length < 3) return { suggestions: [] };
  await reserveUsage('tomtomSuggest');
  const latitude = numberOrNull(body && body.latitude) ?? 59.9110;
  const longitude = numberOrNull(body && body.longitude) ?? 10.7522;
  const requestBody = {
    query: query,
    maxResults: 5,
    filters: { types: ['poi', 'address', 'street', 'intersection', 'area'] },
    preferences: { geometry: { type: 'point', coordinates: [longitude, latitude] } }
  };
  const json = await fetchJson(
    'https://api.tomtom.com/maps/orbis/places/suggest',
    {
      method: 'POST',
      headers: {
        'TomTom-Api-Key': TOMTOM_API_KEY,
        'TomTom-Api-Version': '3',
        'Tracking-Id': randomUUID(),
        'Attributes': 'results(id,type,title,subtitles)',
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    },
    'TomTom Suggest'
  );
  return {
    suggestions: (Array.isArray(json && json.results) ? json.results : []).map(function (item) {
      const id = cleanString(item && item.id);
      const type = cleanString(item && item.type);
      const title = cleanString(item && item.title);
      if (!id || !type || !title || !LOCATION_DETAILS_TYPE_MAP[type]) return null;
      return {
        id: id,
        type: type,
        title: title,
        subtitle: Array.isArray(item.subtitles) ? item.subtitles.filter(function (v) { return typeof v === 'string'; }).join(', ') : ''
      };
    }).filter(Boolean)
  };
}

async function resolveSuggestedLocation(body) {
  if (!TOMTOM_API_KEY) throw codedError('MISSING_TOMTOM_API_KEY', 503);
  const id = cleanString(body && body.id);
  const type = cleanString(body && body.type);
  const detailsType = type ? LOCATION_DETAILS_TYPE_MAP[type] : null;
  if (!id || !type || !detailsType) throw codedError('INVALID_LOCATION_SELECTION');
  await reserveUsage('tomtomDetails');
  const url = 'https://api.tomtom.com/maps/orbis/places/details/' + encodeURIComponent(detailsType) + '/' + encodeURIComponent(id);
  const json = await fetchJson(
    url,
    {
      method: 'GET',
      headers: {
        'TomTom-Api-Key': TOMTOM_API_KEY,
        'TomTom-Api-Version': '3',
        'Tracking-Id': randomUUID(),
        'Attributes': 'id,type,title,position.coordinates,address(street,houseNumber,postalCode,municipality,municipalitySubdivision)',
        'Accept': 'application/json'
      }
    },
    'TomTom Details'
  );
  const coordinates = json && json.position && json.position.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) throw codedError('LOCATION_HAS_NO_COORDINATES', 502);
  const longitude = numberOrNull(coordinates[0]);
  const latitude = numberOrNull(coordinates[1]);
  if (latitude === null || longitude === null) throw codedError('LOCATION_HAS_NO_COORDINATES', 502);
  return {
    id: id,
    type: type,
    title: cleanString(json && json.title) || 'Selected location',
    address: tomtomAddress(json),
    latitude: latitude,
    longitude: longitude
  };
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let body = '';
    req.on('data', function (chunk) {
      body += chunk;
      if (body.length > 128 * 1024) {
        reject(codedError('REQUEST_TOO_LARGE', 413));
        req.destroy();
      }
    });
    req.on('end', function () {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(codedError('INVALID_JSON')); }
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
    const url = new URL(req.url, 'http://' + (req.headers.host || '127.0.0.1'));

    if (req.method === 'GET' && url.pathname === '/status') {
      const usage = loadUsage();
      return sendJson(res, 200, {
        ok: true,
        buildId: BUILD_ID,
        service: 'NearTime backend',
        placeDiscovery: 'TomTom Places Search Discover',
        pedestrianRouting: 'Self-hosted Valhalla matrix',
        valhallaBaseUrl: VALHALLA_BASE_URL,
        categoryCount: CATEGORY_IDS.length,
        targetResults: RESULT_LIMIT,
        discoverMaxCandidates: DISCOVER_CANDIDATE_LIMIT,
        hardRules: {
          paidPlaceDiscoveryCallsPerExplicitSearch: 1,
          paidPedestrianRoutingCallsPerExplicitSearch: 0,
          googlePlacesCallsPerExplicitSearch: 0,
          localWalkingMatrixCallsPerExplicitSearch: 1,
          noPaidCallsOnStartupGpsFilterOrMapMovement: true,
          openNowFailClosed: true,
          noResultPadding: true
        },
        activeMonthlyUsage: {
          tomtomDiscover: usage.tomtomDiscover,
          tomtomSuggest: usage.tomtomSuggest,
          tomtomDetails: usage.tomtomDetails,
          valhallaMatrix: usage.valhallaMatrix
        },
        historicalUsagePreserved: {
          tomtomRoute: usage.tomtomRoute,
          googleNearbyPro: usage.googleNearbyPro,
          googleNearbyEnterprise: usage.googleNearbyEnterprise
        },
        monthlyLimits: MONTHLY_LIMITS
      });
    }

    if (req.method === 'POST' && url.pathname === '/spike/search') {
      const input = validateSearchInput(await readJsonBody(req));
      return sendJson(res, 200, await executeSearch(input));
    }
    if (req.method === 'POST' && url.pathname === '/location/suggest') {
      return sendJson(res, 200, await suggestLocations(await readJsonBody(req)));
    }
    if (req.method === 'POST' && url.pathname === '/location/resolve') {
      return sendJson(res, 200, await resolveSuggestedLocation(await readJsonBody(req)));
    }
    return sendJson(res, 404, { error: 'NOT_FOUND' });
  } catch (error) {
    return sendJson(res, Number(error && error.status) || 500, {
      error: cleanString(error && error.code) || cleanString(error && error.message) || 'INTERNAL_ERROR'
    });
  }
}

function startServer() {
  if (!TOMTOM_API_KEY) {
    console.error('FATAL: TOMTOM_API_KEY missing');
    process.exit(1);
  }
  const server = http.createServer(handleHttp);
  server.listen(PORT, '0.0.0.0', function () {
    console.log('NearTime backend listening on 0.0.0.0:' + PORT);
    console.log('Build: ' + BUILD_ID);
    console.log('Categories: ' + CATEGORY_IDS.length);
    console.log('Place discovery: TomTom Places Search Discover');
    console.log('Pedestrian routing: self-hosted Valhalla matrix');
    console.log('Paid calls per explicit search: max 1 discovery + 0 routing');
    console.log('Google Places calls per explicit search: 0');
    console.log('Paid calls on startup/GPS/filter/map movement: 0');
    console.log('Valhalla: ' + VALHALLA_BASE_URL);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) startServer();

export {
  CATEGORY_CONFIG,
  MONTHLY_LIMITS,
  HARD_MAX,
  RESULT_LIMIT,
  validateCategoryConfigAtStartup,
  validateSearchInput,
  discoverAttributes,
  isOpenAtEpoch,
  normalizeTomTomPlace,
  searchTomTomDiscover,
  getWalkingMatrix,
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
  extractMatrixRow,
  wallClockToUtc,
  tomtomAddress
};
