// Tier-2 live registration. `getAddressForLabel` reads seed-then-store so the
// CCIP path resolves freshly-claimed names; `registerName` writes through to a
// persistent JSON file (survives restarts when DATA_DIR is a mounted volume).
//
// The store path is resolved lazily from DATA_DIR on each access, so tests can
// point it at a temp dir. getAddressForLabel keeps the exact signature the CCIP
// handler depends on.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getAddress, isAddress } from 'viem'

const SEED = { alice: '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21' } // stays working on a fresh deploy
const RESERVED = new Set(['lend', 'borrow', 'alice', 'seikine', 'eth', 'www']) // action words + seed + noise

let registered = {} // in-memory cache: lowercased label -> checksummed addr
let loadedPath = null

function dataDir() {
  return process.env.DATA_DIR || './data'
}
function storePath() {
  return join(dataDir(), 'names.json')
}

function ensureLoaded() {
  const p = storePath()
  if (loadedPath === p) return
  registered = {}
  loadedPath = p
  try {
    if (existsSync(p)) registered = JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    registered = {} // fresh start if unreadable
  }
}

/** @internal test hook — drop the cache so the next access reloads from disk. */
export function _reload() {
  loadedPath = null
  ensureLoaded()
}

export function getAddressForLabel(label) {
  ensureLoaded()
  const k = String(label || '').toLowerCase()
  return SEED[k] ?? registered[k] ?? null // seed wins (protects alice), then live registrations
}

export function registerName(name, address) {
  ensureLoaded()
  const label = String(name || '').toLowerCase()
  if (!/^[a-z0-9-]{1,32}$/.test(label)) return { error: 'invalid name (use a-z, 0-9, -, ≤32 chars)' }
  if (RESERVED.has(label)) return { error: `"${label}" is reserved` }
  if (registered[label]) return { error: `"${label}" is already taken` } // first-come-first-served
  if (!isAddress(address)) return { error: 'invalid Ethereum address' }

  const addr = getAddress(address) // checksum it
  registered[label] = addr
  try {
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(storePath(), JSON.stringify(registered, null, 2)) // write-through
  } catch {
    /* in-memory still works for this session */
  }
  return {
    ok: true,
    label,
    address: addr,
    names: [`${label}.seikine.eth`, `lend.${label}.seikine.eth`, `borrow.${label}.seikine.eth`],
  }
}
