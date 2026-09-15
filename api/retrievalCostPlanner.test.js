'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_LIST_PRICE_MICROUSD,
  chooseCheapestObservedStrategy,
  retrievalCostMicroUsd,
  shouldEscalateNearby,
} = require('./lib/retrievalCostPlanner');

test('list-price constants reflect current Nearby and Details unit economics', () => {
  assert.equal(DEFAULT_LIST_PRICE_MICROUSD.nearbyCall, 40000);
  assert.equal(DEFAULT_LIST_PRICE_MICROUSD.placeDetailsCall, 20000);
});

test('retrieval cost matches measured four-cell and nine-cell experiments', () => {
  assert.equal(retrievalCostMicroUsd({ nearbyCalls: 4, missingCount: 19 }), 540000);
  assert.equal(retrievalCostMicroUsd({ nearbyCalls: 9, missingCount: 4 }), 440000);
});

test('nine-cell observed result is cheaper than four-cell observed result', () => {
  const result = chooseCheapestObservedStrategy([
    { name: 'four-cell', nearbyCalls: 4, missingCount: 19 },
    { name: 'nine-cell', nearbyCalls: 9, missingCount: 4 },
  ]);

  assert.equal(result.best.name, 'nine-cell');
  assert.equal(result.best.costMicroUsd, 440000);
});

test('planner blocks a next stage when its call cost is not below resolving all remaining ids with Details', () => {
  const decision = shouldEscalateNearby({
    missingCount: 4,
    additionalNearbyCalls: 7,
  });

  assert.equal(decision.escalate, false);
  assert.equal(decision.fallbackNowMicroUsd, 80000);
  assert.equal(decision.nextStageMicroUsd, 280000);
  assert.equal(decision.breakEvenRecoveredCandidates, 15);
});

test('planner admits a cheaper exploratory stage only when its direct cost is below current Details fallback', () => {
  const decision = shouldEscalateNearby({
    missingCount: 19,
    additionalNearbyCalls: 5,
  });

  assert.equal(decision.escalate, true);
  assert.equal(decision.fallbackNowMicroUsd, 380000);
  assert.equal(decision.nextStageMicroUsd, 200000);
  assert.equal(decision.breakEvenRecoveredCandidates, 11);
});
