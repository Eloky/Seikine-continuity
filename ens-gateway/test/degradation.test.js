// Test 4 — graceful degradation. A PriceFeedStale (0x216cc5f5) revert must NOT
// fail the resolve; the key's value becomes a degraded string, still signed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeRead } from '../src/controller.js'
import { resolveKey } from '../src/records.js'

const USER = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21'

function staleError() {
  // Shape mirrors a viem ContractFunctionExecutionError carrying the raw selector.
  const e = new Error('execution reverted')
  e.data = '0x216cc5f5' // PriceFeedStale()
  return e
}

test('PriceFeedStale read -> "unavailable (price feed stale)"', async () => {
  const reads = {
    debtUSD: () => safeRead(() => { throw staleError() }),
  }
  const value = await resolveKey('seikine:debtUSD', 'borrow', USER, reads)
  assert.equal(value, 'unavailable (price feed stale)')
})

test('non-stale revert -> generic "unavailable"', async () => {
  const reads = {
    collateralUSD: () => safeRead(() => { throw new Error('network blip') }),
  }
  const value = await resolveKey('seikine:collateralUSD', 'lend', USER, reads)
  assert.equal(value, 'unavailable')
})

test('stale on one leg of LTV degrades the whole key', async () => {
  const reads = {
    debtUSD: () => safeRead(() => { throw staleError() }),
    collateralUSD: async () => 90590000000000000000n,
  }
  const value = await resolveKey('seikine:ltv', 'borrow', USER, reads)
  assert.equal(value, 'unavailable (price feed stale)')
})
