import { useEffect, useState } from 'react';

import App from '../../App';
import type { LaunchProduct } from '../purchases/catalog';
import { purchaseAndActivate } from '../purchases/purchaseFlow';
import { StorePurchaseUnavailableError } from '../purchases/purchaseBoundary';
import { PaywallModal } from './PaywallModal';
import { subscribePaywall } from './paywallSignal';

function purchaseErrorMessage(error: unknown): string {
  if (error instanceof StorePurchaseUnavailableError) {
    return 'Store checkout is not enabled in this development build yet.';
  }
  if (error instanceof Error && error.message === 'TRIP_PASS_SERVER_VERIFICATION_NOT_CONFIGURED') {
    return 'Trip Pass verification is not enabled yet. No access was activated.';
  }
  if (error instanceof Error && error.message.startsWith('ENTITLEMENT_VERIFICATION_FAILED_')) {
    return 'The store purchase could not be verified by NearTime. No access was activated.';
  }
  return 'Purchase could not be completed. No access was activated.';
}

export default function AppRoot() {
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  useEffect(() => subscribePaywall(() => {
    setPurchaseError(null);
    setPaywallVisible(true);
  }), []);

  const purchase = async (product: LaunchProduct) => {
    try {
      setBusyProductId(product.id);
      setPurchaseError(null);
      await purchaseAndActivate(product);
      setPaywallVisible(false);
    } catch (error) {
      setPurchaseError(purchaseErrorMessage(error));
    } finally {
      setBusyProductId(null);
    }
  };

  return (
    <>
      <App />
      <PaywallModal
        visible={paywallVisible}
        busyProductId={busyProductId}
        errorMessage={purchaseError}
        onClose={() => setPaywallVisible(false)}
        onPurchase={(product) => void purchase(product)}
      />
    </>
  );
}
