import type { Category, OpenForMinutes, ReviewMinimum, SortKey, TravelMinutes, TravelMode } from './types';

export const categories: Array<{ label: Category; icon: string }> = [
  { label: 'Restaurant', icon: 'restaurant' },
  { label: 'Cafe', icon: 'local-cafe' },
  { label: 'Grocery', icon: 'local-grocery-store' },
  { label: 'Pharmacy', icon: 'local-pharmacy' },
  { label: 'Parking', icon: 'local-parking' },
];

export const travelOptions: TravelMinutes[] = [5, 10, 15, 20];

// Names match MaterialIcons (bundled with Expo via @expo/vector-icons).
export const travelModes: Array<{ label: TravelMode; icon: string }> = [
  { label: 'Walk', icon: 'directions-walk' },
  { label: 'Drive', icon: 'directions-car' },
  { label: 'Bike', icon: 'directions-bike' },
];

export const reviewOptions: ReviewMinimum[] = [0, 100, 300, 1000];
export const openForOptions: OpenForMinutes[] = [0, 60, 120, 180];

export const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: 'time', label: 'Travel time' },
  { key: 'rating', label: 'Rating' },
  { key: 'distance', label: 'Distance' },
  { key: 'price', label: 'Price' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'open', label: 'Open longest' },
];
