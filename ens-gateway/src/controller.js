// Live controller reads over RPC (viem) + graceful-degradation wrapper.
//
// The deployed SeikineLendingController's price-touching views revert
// `PriceFeedStale()` (selector 0x216cc5f5) whenever a Chainlink feed lags past
// the controller's staleness limit — which on a testnet feed will happen. We
// catch that and surface a degraded string rather than failing the resolve, so
// the breaker is visible *through ENS* instead of breaking the demo.

import { createPublicClient, http, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'

export const controllerAbi = parseAbi([
  'function userTotalCollateralUSD(address user) view returns (uint256)',
  'function userTotalDebtUSD(address user) view returns (uint256)',
  'function userHealthFactorBps(address user) view returns (uint256)',
  'function userCollateralVaults(address user) view returns (address[])',
  'function userDebtAssets(address user) view returns (address[])',
])

export const STALE_SELECTOR = '216cc5f5' // PriceFeedStale()

/** Flatten a viem error (cause chain + raw revert data) into one searchable string. */
function errorBlob(e) {
  let s = ''
  let cur = e
  for (let i = 0; i < 12 && cur; i++) {
    for (const f of [cur.data, cur.raw, cur.signature, cur.shortMessage, cur.message]) {
      if (typeof f === 'string') s += ' ' + f
    }
    if (Array.isArray(cur.metaMessages)) s += ' ' + cur.metaMessages.join(' ')
    cur = cur.cause
  }
  return s.toLowerCase()
}

/** Run a controller read; on revert, throw a `{ degraded }`-tagged error. */
export async function safeRead(fn) {
  try {
    return await fn()
  } catch (e) {
    const blob = errorBlob(e)
    const stale = blob.includes(STALE_SELECTOR) || blob.includes('pricefeedstale')
    const degraded = stale ? 'unavailable (price feed stale)' : 'unavailable'
    const err = new Error(degraded)
    err.degraded = degraded
    throw err
  }
}

/** Build the reader the records layer consumes. Price reads are degradation-wrapped. */
export function makeReads(client, controllerAddress) {
  const read = (functionName, args) =>
    client.readContract({ address: controllerAddress, abi: controllerAbi, functionName, args })
  return {
    collateralUSD: (u) => safeRead(() => read('userTotalCollateralUSD', [u])),
    debtUSD: (u) => safeRead(() => read('userTotalDebtUSD', [u])),
    healthFactorBps: (u) => safeRead(() => read('userHealthFactorBps', [u])),
    // Array reads don't touch prices -> no staleness revert, no wrapper needed.
    collateralVaults: (u) => read('userCollateralVaults', [u]),
    debtAssets: (u) => read('userDebtAssets', [u]),
  }
}

export function makeClient(rpcUrl) {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
}
