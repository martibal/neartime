import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.USAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'neartime-52-'));
process.env.TOMTOM_API_KEY = 'test-tomtom';
process.env.GOOGLE_PLACES_API_KEY = 'test-google';

const mod = await import('./server.js');
const expectedIds = ["cafes_coffee", "restaurants", "fast_food_takeaway", "bars_drinks", "bakeries_sweets", "groceries_supermarkets", "clothing_fashion", "electronics", "home_furniture", "shopping_centres", "other_shops", "pharmacy", "doctor_clinic", "dentist", "hospital", "spa_wellness", "gym_fitness", "swimming", "sports_facilities", "golf", "parking", "public_transport", "train_stations", "bus_stations_stops", "fuel_stations", "ev_charging", "airports", "schools", "preschool", "universities", "libraries", "parks", "outdoor_activities", "museums_galleries", "cinema", "entertainment", "attractions", "playgrounds", "hotels", "hostels_guest_houses", "camping", "hair_beauty", "laundry", "banks", "atm", "post_office", "shipping_courier", "car_repair_tyres", "car_wash", "veterinary", "pet_care", "pet_stores"];
const legacyIds = ["fuel_ev_charging", "cinema_entertainment", "bank_atm", "post_shipping", "car_services", "pet_services"];
const splitIds = ["fuel_stations", "ev_charging", "cinema", "entertainment", "banks", "atm", "post_office", "shipping_courier", "car_repair_tyres", "car_wash", "veterinary", "pet_care", "pet_stores"];

test('backend exposes exactly the new 52 category IDs', () => {
  assert.deepEqual(Object.keys(mod.CATEGORY_CONFIG), expectedIds);
});

test('legacy heterogeneous category IDs are gone', () => {
  for (const id of legacyIds) {
    assert.equal(Object.prototype.hasOwnProperty.call(mod.CATEGORY_CONFIG, id), false, id);
  }
});

test('all split category IDs are present', () => {
  for (const id of splitIds) {
    assert.equal(Object.prototype.hasOwnProperty.call(mod.CATEGORY_CONFIG, id), true, id);
  }
});

test('fuel and EV are independent one-intent categories', () => {
  assert.deepEqual(mod.CATEGORY_CONFIG.fuel_stations.googleTypes, ['gas_station']);
  assert.deepEqual(mod.CATEGORY_CONFIG.ev_charging.googleTypes, ['electric_vehicle_charging_station']);
});

test('bank and ATM are independent one-intent categories', () => {
  assert.deepEqual(mod.CATEGORY_CONFIG.banks.googleTypes, ['bank']);
  assert.deepEqual(mod.CATEGORY_CONFIG.atm.googleTypes, ['atm']);
});

test('car wash cannot crowd out car repair and tyres', () => {
  assert.deepEqual(mod.CATEGORY_CONFIG.car_wash.googleTypes, ['car_wash']);
  assert.deepEqual(mod.CATEGORY_CONFIG.car_repair_tyres.googleTypes, ['car_repair', 'tire_shop']);
});

test('pet veterinary, care, and stores are separated', () => {
  assert.deepEqual(mod.CATEGORY_CONFIG.veterinary.googleTypes, ['veterinary_care']);
  assert.deepEqual(mod.CATEGORY_CONFIG.pet_care.googleTypes, ['pet_care', 'pet_boarding_service']);
  assert.deepEqual(mod.CATEGORY_CONFIG.pet_stores.googleTypes, ['pet_store']);
});

test('one Google Nearby call per explicit search remains enforced', () => {
  const source = fs.readFileSync('./server.js', 'utf8');
  assert.ok(source.includes('const GOOGLE_CALLS_PER_SEARCH_CAP = 1'));
  assert.ok(source.includes('places:searchNearby'));
  assert.equal(source.includes('places:searchText'), false);
  assert.equal(source.includes('/maps/orbis/places/discover'), false);
});

test('routing pacing and max 20 route calls remain', () => {
  const source = fs.readFileSync('./server.js', 'utf8');
  assert.ok(source.includes('const TOMTOM_ROUTE_CALLS_PER_SEARCH_CAP = 20'));
  assert.ok(source.includes('const TOMTOM_ROUTE_MIN_INTERVAL_MS = 300'));
  assert.ok(source.includes('await paceTomTomRoute(perSearch);'));
});

test('open-now remains fail-closed', () => {
  const cfg = mod.CATEGORY_CONFIG.bars_drinks;
  const base = {
    id: 'p1',
    displayName: { text: 'Bar One' },
    location: { latitude: 59.91, longitude: 10.75 },
    businessStatus: 'OPERATIONAL',
    primaryType: 'bar',
    primaryTypeDisplayName: { text: 'Bar' },
    types: ['bar', 'establishment']
  };
  assert.equal(mod.normalizeGoogleNearbyPlace(base, cfg, true), null);
  assert.ok(mod.normalizeGoogleNearbyPlace(
    { ...base, currentOpeningHours: { openNow: true } },
    cfg,
    true
  ));
});

test('closed and moved places remain fail-closed', () => {
  const cfg = mod.CATEGORY_CONFIG.restaurants;
  const base = {
    id: 'p2',
    displayName: { text: 'Restaurant One' },
    location: { latitude: 59.91, longitude: 10.75 },
    businessStatus: 'OPERATIONAL',
    primaryType: 'restaurant',
    primaryTypeDisplayName: { text: 'Restaurant' },
    types: ['restaurant', 'establishment']
  };
  assert.equal(mod.normalizeGoogleNearbyPlace(
    { ...base, businessStatus: 'CLOSED_PERMANENTLY' },
    cfg,
    false
  ), null);
  assert.equal(mod.normalizeGoogleNearbyPlace(
    { ...base, movedPlaceId: 'new-id' },
    cfg,
    false
  ), null);
});
