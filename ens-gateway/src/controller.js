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

// ── token symbols (USDC, not 0x3DfC…) — layered: known map -> cache -> live ──
const KNOWN = {
  '0x3dfc8b53dafa5ebbb071a8b97678ab534ed838d9': 'USDC', // demo debt token (lowercased)
}
const symCache = new Map()
const symbolAbi = [
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
]

/** Resolve a token/vault address to its `symbol()`. Instant for known tokens,
 *  cached for live lookups, and falls back to the address on any revert — so a
 *  missing symbol never breaks the resolve. */
export async function tokenSymbol(client, address) {
  const k = address.toLowerCase()
  if (KNOWN[k]) return KNOWN[k]
  if (symCache.has(k)) return symCache.get(k)
  try {
    const sym = await client.readContract({ address, abi: symbolAbi, functionName: 'symbol' })
    symCache.set(k, sym)
    return sym
  } catch {
    return address // graceful fallback
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
    // Token/vault display symbol (falls back to the address).
    symbol: (address) => tokenSymbol(client, address),
  }
}

export function makeClient(rpcUrl) {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
}
