import { Platform } from 'react-native';

import type { LaunchProduct } from './catalog';

export type StorePlatform = 'ios' | 'android';

export type VerifiedPurchaseReceipt =
  | {
      platform: 'ios';
      kind: 'subscription';
      productId: string;
      originalTransactionId: string;
      environment: 'Sandbox' | 'Production';
    }
  | {
      platform: 'android';
      kind: 'subscription';
      productId: string;
      purchaseToken: string;
    }
  | {
      platform: 'ios';
      kind: 'trip_pass';
      productId: string;
      transactionId: string;
      environment: 'Sandbox' | 'Production';
    }
  | {
      platform: 'android';
      kind: 'trip_pass';
      productId: string;
      purchaseToken: string;
    };

export class StorePurchaseUnavailableError extends Error {
  constructor() {
    super('STORE_PURCHASE_NOT_CONFIGURED');
    this.name = 'StorePurchaseUnavailableError';
  }
}

export function currentStorePlatform(): StorePlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

/**
 * Native store purchase boundary.
 *
 * This deliberately fails closed until the native billing adapter and the
 * matching App Store / Google Play products have been configured. The app must
 * never synthesize a receipt or activate an entitlement client-side.
 */
export async function beginStorePurchase(_product: LaunchProduct): Promise<VerifiedPurchaseReceipt> {
  throw new StorePurchaseUnavailableError();
}
