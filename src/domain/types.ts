export type Category = 'Restaurant' | 'Cafe' | 'Grocery' | 'Pharmacy' | 'Parking';
export type TravelMinutes = 5 | 10 | 15 | 20;
export type TravelMode = 'Walk' | 'Drive' | 'Bike';
export type ReviewMinimum = 0 | 100 | 300 | 1000;
export type OpenForMinutes = 0 | 60 | 120 | 180;
export type SortKey = 'time' | 'rating' | 'distance' | 'price' | 'reviews' | 'open';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type Place = {
  id: string;
  name: string;
  category: Category;
  walkMinutes: number;
  driveMinutes: number;
  bikeMinutes: number;
  distanceMeters: number;
  rating: number;
  reviewCount: number;
  priceLevel: number;
  price: string;
  open: boolean;
  closesInMinutes: number;
  address: string;
  phone: string;
  website: string;
  highlights: string[];
  latitudeOffset: number;
  longitudeOffset: number;
};

export type SearchQuery = {
  category: Category;
  travelMode: TravelMode;
  maxMinutes: TravelMinutes;
  minimumRating: number;
  minimumReviews: ReviewMinimum;
  openNow: boolean;
  openForMinutes: OpenForMinutes;
};
