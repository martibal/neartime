import { Platform } from 'react-native';
import {
  endConnection,
  fetchProducts,
  finishTransaction,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';

import type { LaunchProduct } from './catalog';
import type { VerifiedPurchaseReceipt } from './purchaseBoundary';

type PendingPurchase = {
  product: LaunchProduct;
  resolve: (receipt: VerifiedPurchaseReceipt) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type SubscriptionProductShape = {
  id: string;
  subscriptionOffers?: Array<{
    id?: string | null;
    offerTokenAndroid?: string | null;
    basePlanIdAndroid?: string | null;
  }> | null;
};

let initialized = false;
let initializing: Promise<void> | null = null;
let pending: PendingPurchase | null = null;
const purchasesAwaitingFinish = new Map<string, Purchase>();
let removePurchaseUpdatedListener: (() => void) | null = null;
let removePurchaseErrorListener: (() => void) | null = null;

function receiptKey(receipt: VerifiedPurchaseReceipt): string {
  if (receipt.platform === 'ios') {
    return `${receipt.platform}:${receipt.kind}:${receipt.kind === 'subscription' ? receipt.originalTransactionId : receipt.transactionId}`;
  }
  return `${receipt.platform}:${receipt.kind}:${receipt.purchaseToken}`;
}

function environmentForPurchase(purchase: Purchase): 'Sandbox' | 'Production' {
  const value = 'environmentIOS' in purchase ? purchase.environmentIOS : undefined;
  return value === 'Sandbox' ? 'Sandbox' : 'Production';
}

function buildReceipt(product: LaunchProduct, purchase: Purchase): VerifiedPurchaseReceipt {
  if (purchase.productId !== product.id) {
    throw new Error('STORE_PRODUCT_MISMATCH');
  }

  if (Platform.OS === 'ios') {
    if (product.kind === 'subscription') {
      const originalTransactionId = 'originalTransactionIdentifierIOS' in purchase
        ? purchase.originalTransactionIdentifierIOS
        : undefined;
      const value = String(originalTransactionId ?? purchase.id ?? '').trim();
      if (!value) throw new Error('STORE_RECEIPT_MISSING_ORIGINAL_TRANSACTION_ID');
      return {
        platform: 'ios',
        kind: 'subscription',
        productId: product.id,
        originalTransactionId: value,
        environment: environmentForPurchase(purchase),
      };
    }

    const transactionId = String(purchase.id ?? '').trim();
    if (!transactionId) throw new Error('STORE_RECEIPT_MISSING_TRANSACTION_ID');
    return {
      platform: 'ios',
      kind: 'trip_pass',
      productId: product.id,
      transactionId,
      environment: environmentForPurchase(purchase),
    };
  }

  if (Platform.OS === 'android') {
    const purchaseToken = String(purchase.purchaseToken ?? '').trim();
    if (!purchaseToken) throw new Error('STORE_RECEIPT_MISSING_PURCHASE_TOKEN');
    return {
      platform: 'android',
      kind: product.kind,
      productId: product.id,
      purchaseToken,
    } as VerifiedPurchaseReceipt;
  }

  throw new Error('STORE_PLATFORM_UNSUPPORTED');
}

function settlePurchase(purchase: Purchase) {
  if (!pending) return;
  if (purchase.productId !== pending.product.id) return;

  const current = pending;
  pending = null;
  clearTimeout(current.timeout);

  try {
    const receipt = buildReceipt(current.product, purchase);
    purchasesAwaitingFinish.set(receiptKey(receipt), purchase);
    current.resolve(receipt);
  } catch (error) {
    current.reject(error instanceof Error ? error : new Error('STORE_RECEIPT_INVALID'));
  }
}

function failPendingPurchase(message: string) {
  if (!pending) return;
  const current = pending;
  pending = null;
  clearTimeout(current.timeout);
  current.reject(new Error(message));
}

async function ensureStoreConnection(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    const connected = await initConnection();
    if (!connected) throw new Error('STORE_CONNECTION_FAILED');

    const purchaseSub = purchaseUpdatedListener((purchase) => settlePurchase(purchase));
    const errorSub = purchaseErrorListener((error) => {
      failPendingPurchase(error?.message ? `STORE_PURCHASE_FAILED:${error.message}` : 'STORE_PURCHASE_FAILED');
    });

    removePurchaseUpdatedListener = () => purchaseSub.remove();
    removePurchaseErrorListener = () => errorSub.remove();
    initialized = true;
  })();

  try {
    await initializing;
  } finally {
    initializing = null;
  }
}

async function androidSubscriptionOffer(productId: string): Promise<string> {
  const products = await fetchProducts({ skus: [productId], type: 'subs' });
  const product = (products ?? []).find((candidate) => candidate.id === productId) as SubscriptionProductShape | undefined;
  const offers = product?.subscriptionOffers ?? [];
  const basePlan = offers.find((offer) => !offer.id && offer.offerTokenAndroid) ?? offers.find((offer) => offer.offerTokenAndroid);
  const token = basePlan?.offerTokenAndroid?.trim();
  if (!token) throw new Error('STORE_SUBSCRIPTION_OFFER_UNAVAILABLE');
  return token;
}

export async function purchaseFromNativeStore(product: LaunchProduct): Promise<VerifiedPurchaseReceipt> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') throw new Error('STORE_PLATFORM_UNSUPPORTED');
  if (pending) throw new Error('STORE_PURCHASE_ALREADY_IN_PROGRESS');

  await ensureStoreConnection();

  const receiptPromise = new Promise<VerifiedPurchaseReceipt>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending?.product.id === product.id) pending = null;
      reject(new Error('STORE_PURCHASE_TIMED_OUT'));
    }, 120_000);
    pending = { product, resolve, reject, timeout };
  });

  try {
    if (product.kind === 'subscription') {
      if (Platform.OS === 'android') {
        const offerToken = await androidSubscriptionOffer(product.id);
        await requestPurchase({
          request: {
            apple: { sku: product.id },
            google: {
              skus: [product.id],
              subscriptionOffers: [{ sku: product.id, offerToken }],
            },
          },
          type: 'subs',
        });
      } else {
        await requestPurchase({
          request: { apple: { sku: product.id }, google: { skus: [product.id] } },
          type: 'subs',
        });
      }
    } else {
      await fetchProducts({ skus: [product.id], type: 'in-app' });
      await requestPurchase({
        request: { apple: { sku: product.id }, google: { skus: [product.id] } },
        type: 'in-app',
      });
    }
  } catch (error) {
    failPendingPurchase(error instanceof Error ? error.message : 'STORE_PURCHASE_FAILED');
  }

  return receiptPromise;
}

export async function finishVerifiedNativePurchase(receipt: VerifiedPurchaseReceipt): Promise<void> {
  const key = receiptKey(receipt);
  const purchase = purchasesAwaitingFinish.get(key);
  if (!purchase) throw new Error('STORE_PURCHASE_NOT_AVAILABLE_TO_FINISH');

  await finishTransaction({
    purchase,
    isConsumable: receipt.kind === 'trip_pass',
  });
  purchasesAwaitingFinish.delete(key);
}

export async function shutdownNativeStore(): Promise<void> {
  if (pending) failPendingPurchase('STORE_CONNECTION_CLOSED');
  removePurchaseUpdatedListener?.();
  removePurchaseErrorListener?.();
  removePurchaseUpdatedListener = null;
  removePurchaseErrorListener = null;
  purchasesAwaitingFinish.clear();
  if (initialized) await endConnection();
  initialized = false;
}
