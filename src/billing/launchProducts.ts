export type LaunchProductKey = 'trip3d' | 'monthly' | 'trip7d';

export type LaunchProduct = {
  key: LaunchProductKey;
  productId: string;
  label: string;
  priceNok: number;
  searches: number;
  durationDays: number | null;
  bestValue: boolean;
};

/**
 * NearTime launch commercial contract.
 *
 * productId values are the canonical identifiers to configure in both stores.
 * Store verification remains server-authoritative; these client values never
 * grant access by themselves.
 */
export const LAUNCH_PRODUCTS: readonly LaunchProduct[] = [
  {
    key: 'trip3d',
    productId: 'neartime_trip_3d',
    label: 'Trip Pass · 3 days',
    priceNok: 29,
    searches: 5,
    durationDays: 3,
    bestValue: false,
  },
  {
    key: 'monthly',
    productId: 'neartime_monthly',
    label: 'Monthly',
    priceNok: 39,
    searches: 9,
    durationDays: null,
    bestValue: false,
  },
  {
    key: 'trip7d',
    productId: 'neartime_trip_7d',
    label: 'Trip Pass · 7 days',
    priceNok: 49,
    searches: 11,
    durationDays: 7,
    bestValue: true,
  },
] as const;

export const FREE_TRIAL = {
  successfulSearches: 3,
  maximumAttempts: 5,
} as const;
