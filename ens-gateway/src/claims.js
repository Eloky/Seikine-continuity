// In-app name claims — the display/handle split that the claim flow keys on.
//
// Two strictly-separate fields (spec §1):
//   displayName  cosmetic, collisions fine, only ever a text("name") output
//   handle       UNIQUE + frozen, the only thing resolution keys on
//                (`handle.seikine.eth` resolves to exactly one address)
//
// First claimant of a base gets the clean handle; everyone after gets an
// address-derived suffix (`-<last4>`). Address-derived (not a counter) so
// derivation is stateless, race-free, and idempotent.
//
// Persistence mirrors names.js: lazy-load from DATA_DIR, write-through to
// claims.json — a SEPARATE file from the legacy names.json, and DATA_DIR is
// gitignored, so live claims never land in the public repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getAddress, isAddress } from 'viem'
import { normalize } from 'viem/ens'

// Reserved bases are NEVER issued clean — always suffixed (spec §7). Editable.
export const RESERVED = new Set([
  'seikine', 'admin', 'www', 'api', 'app', 'gateway', 'resolver', 'registry',
  'controller', 'treasury', 'position', 'positions', 'root', 'mainnet', 'sepolia',
])

const MIN_LEN = 3
const MAX_LEN = 32
const DISPLAY_MAX = 64

// ── normalization ───────────────────────────────────────────────────────────
// ENSIP-15 via viem (wraps @adraffy/ens-normalize). The SAME function runs at
// claim time and at resolve time, and a stored handle always equals
// normalize(handle) — a mismatch here silently breaks resolution (spec §7's
// single highest-risk bug, pinned by claims.test.js).
export function normalizeLabel(raw) {
  return normalize(String(raw ?? ''))
}

// Display name: loose. Drop ASCII control chars + DEL, trim, bound length. No
// normalization, collisions allowed (spec §7 display path).
export function sanitizeDisplayName(raw) {
  let out = ''
  for (const ch of String(raw ?? '')) {
    const c = ch.codePointAt(0)
    if (c >= 0x20 && c !== 0x7f) out += ch
  }
  return out.trim().slice(0, DISPLAY_MAX)
}

// Last N hex chars of an address, lowercased (no 0x). 0x…832A21 -> "2a21".
const lastN = (address, n) => String(address).toLowerCase().slice(-n)

/**
 * Pure handle derivation (spec §2). Stateless given two lookups:
 *   handleExists(h) -> bool        does a claim OR a legacy name occupy label h
 *   handleOwner(h)  -> addr|null   who occupies h (lowercased), for the last4 clash
 * @returns {{valid:true, handle, base, clean}} | {{valid:false, reason}}
 */
export function deriveHandle(rawLabel, address, { handleExists, handleOwner }) {
  let base
  try {
    base = normalizeLabel(rawLabel)
  } catch {
    return { valid: false, reason: 'unnormalizable' }
  }
  if (base === '') return { valid: false, reason: 'empty' }
  if (base.includes('.')) return { valid: false, reason: 'multi_label' }
  const len = [...base].length // count code points, not UTF-16 units
  if (len < MIN_LEN || len > MAX_LEN) return { valid: false, reason: 'too_long' }

  const addrLc = String(address).toLowerCase()
  // Re-normalize the composed `base-suffix` so the stored key still equals
  // normalize(key) even for unicode bases (round-trip guarantee).
  const suffixed = (n) => {
    try {
      return normalizeLabel(`${base}-${lastN(address, n)}`)
    } catch {
      return null
    }
  }

  let handle
  let clean
  if (RESERVED.has(base)) {
    handle = suffixed(4)
    clean = false
  } else if (!handleExists(base)) {
    handle = base
    clean = true
  } else {
    handle = suffixed(4)
    clean = false
  }
  if (handle === null) return { valid: false, reason: 'unnormalizable' }

  // Same-last4 / different-address edge: extend to last6 (spec §2 step 7).
  if (!clean && handleExists(handle) && handleOwner(handle) !== addrLc) {
    const h6 = suffixed(6)
    if (h6 === null) return { valid: false, reason: 'unnormalizable' }
    handle = h6
  }

  return { valid: true, handle, base, clean }
}

// ── persistence (mirrors names.js) ──────────────────────────────────────────
let store = { byHandle: {}, byAddress: {} }
let loadedPath = null

const dataDir = () => process.env.DATA_DIR || './data'
const storePath = () => join(dataDir(), 'claims.json')

function ensureLoaded() {
  const p = storePath()
  if (loadedPath === p) return
  store = { byHandle: {}, byAddress: {} }
  loadedPath = p
  try {
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      store = { byHandle: parsed.byHandle ?? {}, byAddress: parsed.byAddress ?? {} }
    }
  } catch {
    store = { byHandle: {}, byAddress: {} } // fresh start if unreadable
  }
}

function persist() {
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(storePath(), JSON.stringify(store, null, 2)) // write-through
  } catch {
    /* in-memory still serves this session */
  }
}

/** @internal test hook — drop the cache so the next access reloads from disk. */
export function _reload() {
  loadedPath = null
  ensureLoaded()
}

/** Resolution path: look up a claim by its (already-normalized) handle. */
export function getClaimByHandle(handle) {
  ensureLoaded()
  return store.byHandle[String(handle ?? '')] ?? null
}

/** In-app read: look up a claim by the claimant's address (the by_address index). */
export function getClaimByAddress(address) {
  ensureLoaded()
  const h = store.byAddress[String(address ?? '').toLowerCase()]
  return h ? store.byHandle[h] ?? null : null
}

/** Public projection of a stored record — safe to return over HTTP. */
export function publicClaim(rec) {
  if (!rec) return null
  return {
    displayName: rec.displayName,
    handle: rec.handle,
    base: rec.base,
    name: `${rec.handle}.seikine.eth`,
    clean: rec.clean,
    address: rec.address,
  }
}

// Build handleExists/handleOwner from the store + an injected legacy lookup, so a
// clean handle can never shadow a seed/legacy name (spec §1 hard rule).
function lookups({ legacyLookup } = {}) {
  ensureLoaded()
  const handleExists = (h) => Boolean(store.byHandle[h]) || Boolean(legacyLookup?.(h))
  const handleOwner = (h) => {
    const c = store.byHandle[h]
    if (c) return c.address.toLowerCase()
    const legacy = legacyLookup?.(h)
    return legacy ? String(legacy).toLowerCase() : null
  }
  return { handleExists, handleOwner }
}

/**
 * GET /preview — validation + preview only. NEVER returns "taken" (spec §4):
 * duplication just yields a suffixed handle. Address is optional; without it we
 * return clean/valid and omit the suffixed handle.
 */
export function preview(label, address, deps = {}) {
  const displayName = sanitizeDisplayName(label)

  let base
  try {
    base = normalizeLabel(label)
  } catch {
    return { valid: false, reason: 'unnormalizable' }
  }
  if (base === '') return { valid: false, reason: 'empty' }
  if (base.includes('.')) return { valid: false, reason: 'multi_label' }
  const len = [...base].length
  if (len < MIN_LEN || len > MAX_LEN) return { valid: false, reason: 'too_long' }

  const { handleExists, handleOwner } = lookups(deps)
  const clean = !RESERVED.has(base) && !handleExists(base)

  // With an address we can show the actual (possibly suffixed) handle.
  if (address && isAddress(address, { strict: false })) {
    const d = deriveHandle(label, getAddress(String(address).toLowerCase()), { handleExists, handleOwner })
    if (!d.valid) return d
    return { valid: true, displayName, handle: d.handle, clean: d.clean }
  }

  // No address: a clean handle == base (no suffix needed); otherwise omit handle.
  return clean
    ? { valid: true, displayName, handle: base, clean: true }
    : { valid: true, displayName, clean: false }
}

/**
 * POST /claim — idempotent on address (spec §3/§4). Testnet: no signature; the
 * binding is "whoever called the API asserted it" (consequence is squatting,
 * never fund loss — the on-chain address is the source of truth). SIWE drops in
 * later as one added `signature` field + one verify call (spec §10).
 */
export function claim(label, address, deps = {}) {
  if (!isAddress(address, { strict: false })) return { ok: false, reason: 'invalid_address' }
  ensureLoaded()
  const addr = getAddress(String(address).toLowerCase()) // canonical checksum, any input case
  const addrLc = addr.toLowerCase()
  const displayName = sanitizeDisplayName(label)

  // Idempotent: an address keeps its frozen handle; only displayName updates.
  const existingHandle = store.byAddress[addrLc]
  if (existingHandle && store.byHandle[existingHandle]) {
    const rec = store.byHandle[existingHandle]
    if (displayName) rec.displayName = displayName
    persist()
    return { ok: true, ...publicClaim(rec) }
  }

  const { handleExists, handleOwner } = lookups(deps)
  const d = deriveHandle(label, addr, { handleExists, handleOwner })
  if (!d.valid) return { ok: false, reason: d.reason }

  const rec = {
    handle: d.handle,
    address: addr,
    displayName,
    base: d.base,
    clean: d.clean,
    createdAt: Math.floor(Date.now() / 1000),
  }
  store.byHandle[d.handle] = rec
  store.byAddress[addrLc] = d.handle
  persist()
  return { ok: true, ...publicClaim(rec) }
}
