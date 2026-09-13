import type { Place, SearchQuery, SortKey, TravelMode } from '../domain/types';

export const DEFAULT_ORIGIN = { latitude: 59.9139, longitude: 10.7522 } as const;

export const mockPlaces: Place[] = [
  { id: '1', name: 'Osteria Centro', category: 'Restaurant', walkMinutes: 6, driveMinutes: 3, bikeMinutes: 3, distanceMeters: 430, rating: 4.7, reviewCount: 842, priceLevel: 2, price: '$$', open: true, closesInMinutes: 165, address: 'Centralgata 12', phone: '+47 22 11 22 33', website: 'osteriacentro.example', highlights: ['Dine-in', 'Reservations', 'Outdoor seating'], latitudeOffset: 0.0038, longitudeOffset: -0.0028 },
  { id: '2', name: 'Trattoria Verde', category: 'Restaurant', walkMinutes: 9, driveMinutes: 4, bikeMinutes: 5, distanceMeters: 690, rating: 4.5, reviewCount: 1204, priceLevel: 2, price: '$$', open: true, closesInMinutes: 240, address: 'Parkveien 8', phone: '+47 22 44 55 66', website: 'trattoriaverde.example', highlights: ['Vegetarian options', 'Takeout', 'Reservations'], latitudeOffset: -0.0048, longitudeOffset: 0.0038 },
  { id: '3', name: 'Corner Table', category: 'Restaurant', walkMinutes: 13, driveMinutes: 6, bikeMinutes: 7, distanceMeters: 980, rating: 4.3, reviewCount: 311, priceLevel: 1, price: '$', open: true, closesInMinutes: 95, address: 'Storgata 41', phone: '+47 22 77 88 99', website: 'cornertable.example', highlights: ['Casual', 'Takeout'], latitudeOffset: 0.0065, longitudeOffset: 0.0052 },
  { id: '4', name: 'North Coffee', category: 'Cafe', walkMinutes: 4, driveMinutes: 2, bikeMinutes: 2, distanceMeters: 280, rating: 4.6, reviewCount: 517, priceLevel: 2, price: '$$', open: true, closesInMinutes: 140, address: 'Kaffegata 3', phone: '+47 22 12 13 14', website: 'northcoffee.example', highlights: ['Coffee', 'Breakfast', 'Takeout'], latitudeOffset: 0.0022, longitudeOffset: 0.0018 },
  { id: '5', name: 'City Market', category: 'Grocery', walkMinutes: 7, driveMinutes: 3, bikeMinutes: 4, distanceMeters: 510, rating: 4.2, reviewCount: 189, priceLevel: 1, price: '$', open: true, closesInMinutes: 310, address: 'Torget 5', phone: '+47 22 90 90 90', website: 'citymarket.example', highlights: ['Groceries', 'Fresh food'], latitudeOffset: -0.0032, longitudeOffset: -0.0035 },
  { id: '6', name: 'Central Pharmacy', category: 'Pharmacy', walkMinutes: 8, driveMinutes: 4, bikeMinutes: 5, distanceMeters: 620, rating: 4.4, reviewCount: 96, priceLevel: 2, price: '$$', open: true, closesInMinutes: 75, address: 'Apotekveien 2', phone: '+47 22 66 77 88', website: 'centralpharmacy.example', highlights: ['Pharmacy', 'Health products'], latitudeOffset: 0.0044, longitudeOffset: 0.004 },
  { id: '7', name: 'Station Garage', category: 'Parking', walkMinutes: 12, driveMinutes: 5, bikeMinutes: 8, distanceMeters: 900, rating: 4.1, reviewCount: 273, priceLevel: 2, price: '$$', open: true, closesInMinutes: 720, address: 'Stasjonsplassen 1', phone: '+47 22 33 44 55', website: 'stationgarage.example', highlights: ['Covered parking', 'EV charging'], latitudeOffset: -0.005, longitudeOffset: 0.0012 },
];

export function getTravelMinutes(place: Place, mode: TravelMode) {
  if (mode === 'Drive') return place.driveMinutes;
  if (mode === 'Bike') return place.bikeMinutes;
  return place.walkMinutes;
}

export function modeLabel(mode: TravelMode) {
  if (mode === 'Drive') return 'drive';
  if (mode === 'Bike') return 'bike';
  return 'walk';
}

export function formatDistance(meters: number) {
  return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function filterPlaces(places: Place[], query: SearchQuery) {
  return places
    .filter((place) => place.category === query.category)
    .filter((place) => getTravelMinutes(place, query.travelMode) <= query.maxMinutes)
    .filter((place) => place.rating >= query.minimumRating)
    .filter((place) => place.reviewCount >= query.minimumReviews)
    .filter((place) => !query.openNow || place.open)
    .filter((place) => query.openForMinutes === 0 || place.closesInMinutes >= query.openForMinutes);
}

export function sortPlaces(places: Place[], sortKey: SortKey, travelMode: TravelMode) {
  return [...places].sort((a, b) => {
    if (sortKey === 'rating') return b.rating - a.rating;
    if (sortKey === 'distance') return a.distanceMeters - b.distanceMeters;
    if (sortKey === 'price') return a.priceLevel - b.priceLevel;
    if (sortKey === 'reviews') return b.reviewCount - a.reviewCount;
    if (sortKey === 'open') return b.closesInMinutes - a.closesInMinutes;
    return getTravelMinutes(a, travelMode) - getTravelMinutes(b, travelMode);
  });
}

export function runQuery(places: Place[], query: SearchQuery, sortKey: SortKey) {
  const filtered = filterPlaces(places, query);
  return {
    filtered,
    sorted: sortPlaces(filtered, sortKey, query.travelMode),
  };
}

export function querySummary(query: SearchQuery) {
  const parts = [
    query.category,
    query.travelMode,
    `≤ ${query.maxMinutes} min`,
    `≥ ${query.minimumRating.toFixed(1)} ★`,
  ];
  if (query.minimumReviews > 0) parts.push(`${query.minimumReviews.toLocaleString()}+ reviews`);
  if (query.openNow) parts.push('Open now');
  if (query.openForMinutes > 0) parts.push(`Open ${query.openForMinutes / 60}h+`);
  return parts.join(' · ');
}
