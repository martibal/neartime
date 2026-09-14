import { Platform } from 'react-native';

import type { LaunchProduct } from './catalog';
import { purchaseFromNativeStore } from './nativeStoreAdapter';

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
  constructor(message = 'STORE_PURCHASE_NOT_CONFIGURED') {
    super(message);
    this.name = 'StorePurchaseUnavailableError';
  }
}

export function currentStorePlatform(): StorePlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

/**
 * Native checkout boundary.
 *
 * expo-iap opens the App Store / Google Play checkout and returns only the
 * store receipt identifiers needed for NearTime's server verification. The
 * client still cannot activate an entitlement by itself.
 */
export async function beginStorePurchase(product: LaunchProduct): Promise<VerifiedPurchaseReceipt> {
  if (!currentStorePlatform()) {
    throw new StorePurchaseUnavailableError('STORE_PLATFORM_UNSUPPORTED');
  }
  return purchaseFromNativeStore(product);
}
