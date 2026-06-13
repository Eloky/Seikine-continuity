// Record grammar + formatting. `resolveKey` enforces the action -> allowed-keys
// policy (so each subname is a distinct profile), reads the controller, and
// formats the value. Keys outside the action's set return "".

import { formatUnits } from 'viem'

export const MAX_UINT256 = (1n << 256n) - 1n

// lend = "what she supplied"; borrow = "what she took, against what, how safe".
export const ACTION_KEYS = {
  lend: new Set(['seikine:collateralUSD', 'seikine:collateralAssets']),
  borrow: new Set([
    'seikine:debtUSD',
    'seikine:debtToken',
    'seikine:healthFactor',
    'seikine:ltv',
  ]),
}
const ALL_KEYS = new Set([...ACTION_KEYS.lend, ...ACTION_KEYS.borrow])

/** Is `key` answerable for `action`? No action (bare `<user>`) allows all keys. */
export function isKeyAllowed(key, action) {
  if (action === 'lend') return ACTION_KEYS.lend.has(key)
  if (action === 'borrow') return ACTION_KEYS.borrow.has(key)
  return ALL_KEYS.has(key)
}

// ── formatting (the scale matters — judges read these) ──────────────────────
export const fmtUSD = (raw) => '$' + Number(formatUnits(raw, 18)).toFixed(2) // 1e18 -> "$90.59"
export const fmtHealth = (raw) =>
  raw === MAX_UINT256 ? 'No active debt' : (Number(raw) / 1e4).toFixed(2) + 'x' // bps -> "11.19x"
export const fmtLTV = (debtRaw, collRaw) =>
  collRaw === 0n ? '0.00%' : ((Number(debtRaw) / Number(collRaw)) * 100).toFixed(2) + '%'
export const fmtAddrs = (addrs) => (addrs && addrs.length ? addrs.join(', ') : '')

/**
 * Resolve one text() key to its formatted string value.
 * @param reads injected controller reader (see controller.js / tests)
 */
export async function resolveKey(key, action, user, reads) {
  if (!isKeyAllowed(key, action)) return '' // out-of-grammar -> empty (distinct profiles)
  try {
    switch (key) {
      case 'seikine:collateralUSD':
        return fmtUSD(await reads.collateralUSD(user))
      case 'seikine:debtUSD':
        return fmtUSD(await reads.debtUSD(user))
      case 'seikine:healthFactor':
        return fmtHealth(await reads.healthFactorBps(user))
      case 'seikine:ltv': {
        const [debt, coll] = await Promise.all([reads.debtUSD(user), reads.collateralUSD(user)])
        return fmtLTV(debt, coll)
      }
      case 'seikine:collateralAssets':
        return fmtAddrs(await reads.collateralVaults(user))
      case 'seikine:debtToken':
        return fmtAddrs(await reads.debtAssets(user))
      default:
        return ''
    }
  } catch (e) {
    // Graceful degradation: the name still resolves (a valid signed response),
    // it just reports the breaker tripped. safeRead tags reverts with .degraded.
    if (e && e.degraded) return e.degraded
    throw e
  }
}
