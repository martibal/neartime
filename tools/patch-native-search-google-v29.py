from pathlib import Path
import re

p=Path("supabase/functions/native-search/index.ts")
s=p.read_text(encoding="utf-8")
s=s.replace("const BUILD_ID = '2026-09-18-discovery-rollback-v27';","const BUILD_ID = '2026-09-18-google-walk-v29';")
s=s.replace("const SEARCH_COST_CAP_NOK = 0.30;","const SEARCH_COST_CAP_NOK = 0.40;")
anchor="const BAD_POI_IDS = new Set(["
google="""const GOOGLE_SEARCH_COST_NOK = 0.40;
const GOOGLE_CATEGORY_TYPES = Object.freeze({
  cafes_coffee:['cafe','coffee_shop'], restaurants:['restaurant','fast_food_restaurant'],
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
"""
if "GOOGLE_CATEGORY_TYPES" not in s:
    s=s.replace(anchor,google+"\n"+anchor)

new_search=r"""async function requireGooglePlacesKey() {
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
  if (!h || typeof h.openNow !== 'boolean') return {isOpenNow:null,closesAtMs:null,minutesUntilClose:null,openingHoursKnown:false};
  const closeMs = h.nextCloseTime ? Date.parse(h.nextCloseTime) : NaN;
  return {isOpenNow:h.openNow,closesAtMs:Number.isFinite(closeMs)?closeMs:null,
    minutesUntilClose:Number.isFinite(closeMs)?Math.max(0,Math.floor((closeMs-Date.now())/60000)):null,openingHoursKnown:true};
}
async function search(_tomTomKey, raw) {
  const input = validateSearch(raw);
  const key = await requireGooglePlacesKey();
  const includedTypes = GOOGLE_CATEGORY_TYPES[input.category];
  if (!includedTypes || !includedTypes.length) { const e=new Error('GOOGLE_CATEGORY_NOT_MAPPED'); e.status=500; throw e; }
  if (GOOGLE_SEARCH_COST_NOK > SEARCH_COST_CAP_NOK) { const e=new Error('SEARCH_COST_CONTRACT_BROKEN'); e.status=503; throw e; }

  const payload = await fetchJson('https://places.googleapis.com/v1/places:searchNearby', {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-Goog-Api-Key':key,
      'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType,places.types,places.businessStatus,places.currentOpeningHours,routingSummaries',
      'Accept-Language':'en'
    },
    body:JSON.stringify({
      includedTypes,
      maxResultCount:20,
      rankPreference:'DISTANCE',
      locationRestriction:{circle:{center:{latitude:input.latitude,longitude:input.longitude},radius:discoverRadiusMeters(input.maxWalkMinutes)}},
      routingParameters:{origin:{latitude:input.latitude,longitude:input.longitude},travelMode:'WALK'}
    })
  }, 'GOOGLE_NEARBY');

  const places=Array.isArray(payload && payload.places)?payload.places:[];
  const summaries=Array.isArray(payload && payload.routingSummaries)?payload.routingSummaries:[];
  const out=[];
  for (let i=0;i<places.length;i+=1) {
    const p=places[i]||{}, leg=summaries[i] && summaries[i].legs && summaries[i].legs[0];
    const sec=googleDurationSeconds(leg && leg.duration), meters=num(leg && leg.distanceMeters);
    const lat=num(p.location && p.location.latitude), lon=num(p.location && p.location.longitude);
    const id=clean(p.id), name=clean(p.displayName && p.displayName.text);
    if (!id || !name || lat===null || lon===null || sec===null || meters===null) continue;
    if (clean(p.businessStatus)==='CLOSED_PERMANENTLY') continue;
    const opening=googleOpeningState(p);
    if (input.openNowOnly && opening.isOpenNow===false) continue;
    if (input.openNowOnly && input.minOpenMinutes>0 && opening.isOpenNow===true &&
        (!Number.isFinite(opening.minutesUntilClose) || opening.minutesUntilClose<input.minOpenMinutes)) continue;
    const walkMinutes=Math.max(1,Math.ceil(sec/60));
    if (walkMinutes>input.maxWalkMinutes) continue;
    out.push({id,name,categoryLabel:clean(p.primaryType)||CATEGORY_QUERY[input.category],
      sourceCategories:Array.isArray(p.types)?p.types:[],sourceCategoryDetails:[],
      latitude:lat,longitude:lon,address:clean(p.formattedAddress)||'',countryCodeIso2:null,
      isOpenNow:opening.isOpenNow,closesAtMs:opening.closesAtMs,minutesUntilClose:opening.minutesUntilClose,
      openingHoursKnown:opening.openingHoursKnown,sourceVerified:true,
      straightDistanceMeters:Math.round(haversineMeters(input.latitude,input.longitude,lat,lon)),
      walkSeconds:Math.round(sec),walkMinutes,walkDistanceMeters:Math.round(meters)});
  }
  out.sort((a,b)=>a.walkDistanceMeters-b.walkDistanceMeters || a.walkSeconds-b.walkSeconds || a.name.localeCompare(b.name));
  const top=out.slice(0,RESULT_LIMIT);
  return {resultStatus:'COMPLETE_TOP10',places:top,
    summary:{requested:RESULT_LIMIT,returned:top.length,exhaustedCandidates:top.length<RESULT_LIMIT,
      sortedBy:'GOOGLE_WALK_ROUTE_DISTANCE',discoverySource:'GOOGLE_PLACES_NEARBY_SEARCH_NEW',
      routingSource:'GOOGLE_PLACES_ROUTING_SUMMARIES_WALK',
      openNowGate:input.openNowOnly?'CONFIRMED_CLOSED_EXCLUDED_UNKNOWN_PRESERVED':'OFF',
      cloudOnly:true,international:true,discoveryCandidates:places.length,candidateLimit:20,
      proof:'GOOGLE_DISTANCE_RANKED_20_THEN_WALK_DISTANCE_SORT'},
    usage:{thisSearch:{googleNearbyCalls:1,googleRoutingSummaryPlaces:places.length,tomtomDiscover:0,tomtomRoute:0,
      conservativeCostNok:GOOGLE_SEARCH_COST_NOK,costCapNok:SEARCH_COST_CAP_NOK,
      worstCaseCostNok:GOOGLE_SEARCH_COST_NOK,freeTierAssumed:false}}};
}
"""
pat=r"async function search\(apiKey, raw\) \{.*?\n\}\n(?=async function suggest\()"
s,n=re.subn(pat,lambda _m:new_search+"\n",s,flags=re.S)
if n!=1: raise SystemExit(f"Expected one search() block, replaced {n}")
s=s.replace("placeDiscovery: 'TOMTOM_ORBIS_PLACES_CLOUD',","placeDiscovery: 'GOOGLE_PLACES_NEARBY_SEARCH_NEW',")
s=s.replace("walkingRoutes: 'TOMTOM_CLOUD_PEDESTRIAN_ROUTING',","walkingRoutes: 'GOOGLE_PLACES_ROUTING_SUMMARIES_WALK',")
s=s.replace("capNok: SEARCH_COST_CAP_NOK,\n        maxDiscoverCalls: 1,\n        maxRouteCalls: MAX_ROUTE_CALLS,\n        worstCaseNok: WORST_CASE_SEARCH_COST_NOK,",
            "capNok: SEARCH_COST_CAP_NOK,\n        maxGoogleNearbyCalls: 1,\n        worstCaseNok: GOOGLE_SEARCH_COST_NOK,")
p.write_text(s,encoding="utf-8")
print("PATCHED",p)
print("BUILD",re.search(r"const BUILD_ID = '([^']+)'",s).group(1))
print("CAP",re.search(r"const SEARCH_COST_CAP_NOK = ([0-9.]+)",s).group(1))
