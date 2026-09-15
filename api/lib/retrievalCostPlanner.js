'use strict';

const DEFAULT_LIST_PRICE_MICROUSD = Object.freeze({
  nearbyCall: 40000,
  placeDetailsCall: 20000,
});

function assertNonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`invalid_${name}`);
  return number;
}

function assertPositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`invalid_${name}`);
  return number;
}

function retrievalCostMicroUsd({ nearbyCalls, missingCount, prices = DEFAULT_LIST_PRICE_MICROUSD }) {
  const calls = assertNonNegativeInteger(nearbyCalls, 'nearby_calls');
  const missing = assertNonNegativeInteger(missingCount, 'missing_count');
  const nearbyPrice = assertPositiveInteger(prices.nearbyCall, 'nearby_price');
  const detailsPrice = assertPositiveInteger(prices.placeDetailsCall, 'details_price');
  return (calls * nearbyPrice) + (missing * detailsPrice);
}

function shouldEscalateNearby({ missingCount, additionalNearbyCalls, prices = DEFAULT_LIST_PRICE_MICROUSD }) {
  const missing = assertNonNegativeInteger(missingCount, 'missing_count');
  const additionalCalls = assertPositiveInteger(additionalNearbyCalls, 'additional_nearby_calls');
  const nearbyPrice = assertPositiveInteger(prices.nearbyCall, 'nearby_price');
  const detailsPrice = assertPositiveInteger(prices.placeDetailsCall, 'details_price');

  const fallbackNowMicroUsd = missing * detailsPrice;
  const nextStageMicroUsd = additionalCalls * nearbyPrice;

  // Strict inequality: when the next Nearby stage already costs as much as resolving
  // every remaining known candidate through Details, there is no economic case for
  // taking additional provider risk. This is an admission rule, not a claim that the
  // next stage will necessarily reduce total cost.
  return Object.freeze({
    escalate: nextStageMicroUsd < fallbackNowMicroUsd,
    fallbackNowMicroUsd,
    nextStageMicroUsd,
    breakEvenRecoveredCandidates: Math.floor(nextStageMicroUsd / detailsPrice) + 1,
  });
}

function chooseCheapestObservedStrategy(strategies, prices = DEFAULT_LIST_PRICE_MICROUSD) {
  if (!Array.isArray(strategies) || strategies.length === 0) throw new Error('strategies_required');

  const scored = strategies.map((strategy, index) => {
    const nearbyCalls = assertNonNegativeInteger(strategy?.nearbyCalls, `strategy_${index}_nearby_calls`);
    const missingCount = assertNonNegativeInteger(strategy?.missingCount, `strategy_${index}_missing_count`);
    return Object.freeze({
      ...strategy,
      nearbyCalls,
      missingCount,
      costMicroUsd: retrievalCostMicroUsd({ nearbyCalls, missingCount, prices }),
    });
  });

  scored.sort((a, b) => {
    if (a.costMicroUsd !== b.costMicroUsd) return a.costMicroUsd - b.costMicroUsd;
    if (a.missingCount !== b.missingCount) return a.missingCount - b.missingCount;
    return a.nearbyCalls - b.nearbyCalls;
  });

  return Object.freeze({
    best: scored[0],
    scored: Object.freeze(scored),
  });
}

module.exports = {
  DEFAULT_LIST_PRICE_MICROUSD,
  chooseCheapestObservedStrategy,
  retrievalCostMicroUsd,
  shouldEscalateNearby,
};
