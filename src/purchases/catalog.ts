export type PurchaseKind = 'trip_pass' | 'subscription';

export type LaunchProductId =
  | 'neartime_trip_3d'
  | 'neartime_monthly'
  | 'neartime_trip_7d';

export type LaunchProduct = {
  id: LaunchProductId;
  kind: PurchaseKind;
  title: string;
  priceNok: number;
  searches: number;
  durationDays: number | null;
  badge?: 'Best value';
  subtitle: string;
};

export const LAUNCH_PRODUCTS: readonly LaunchProduct[] = [
  {
    id: 'neartime_trip_3d',
    kind: 'trip_pass',
    title: '3-day Trip Pass',
    priceNok: 29,
    searches: 5,
    durationDays: 3,
    subtitle: '5 searches · active for 3 days from purchase',
  },
  {
    id: 'neartime_monthly',
    kind: 'subscription',
    title: 'Monthly',
    priceNok: 39,
    searches: 9,
    durationDays: null,
    subtitle: '9 searches per billing period',
  },
  {
    id: 'neartime_trip_7d',
    kind: 'trip_pass',
    title: '7-day Trip Pass',
    priceNok: 49,
    searches: 11,
    durationDays: 7,
    badge: 'Best value',
    subtitle: '11 searches · active for 7 days from purchase',
  },
] as const;

export function getLaunchProduct(productId: string): LaunchProduct | null {
  return LAUNCH_PRODUCTS.find((product) => product.id === productId) ?? null;
}
