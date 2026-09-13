import type { Category, OpenForMinutes, ReviewMinimum, SortKey, TravelMinutes, TravelMode } from './types';

export const categories: Array<{ label: Category; emoji: string }> = [
  { label: 'Restaurant', emoji: '🍽️' },
  { label: 'Cafe', emoji: '☕' },
  { label: 'Grocery', emoji: '🛒' },
  { label: 'Pharmacy', emoji: '💊' },
  { label: 'Parking', emoji: '🅿️' },
];

export const travelOptions: TravelMinutes[] = [5, 10, 15, 20];

export const travelModes: Array<{ label: TravelMode; emoji: string }> = [
  { label: 'Walk', emoji: '🚶' },
  { label: 'Drive', emoji: '🚗' },
  { label: 'Bike', emoji: '🚲' },
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
