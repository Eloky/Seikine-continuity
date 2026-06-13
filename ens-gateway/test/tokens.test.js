// Feature 2 — per-asset token symbols. Layered lookup (known -> cache -> live ->
// address fallback) and the debtToken/collateralAssets display wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenSymbol } from '../src/controller.js'
import { resolveKey } from '../src/records.js'

const USDC = '0x3DfC8b53DaFa5EBBb071a8b97678Ab534ED838d9' // in the KNOWN map

// ── tokenSymbol ─────────────────────────────────────────────────────────────
test('known token resolves instantly (no RPC)', async () => {
  const client = { readContract: async () => { throw new Error('RPC should not be called') } }
  assert.equal(await tokenSymbol(client, USDC), 'USDC')
})

test('symbol() revert falls back to the address (never breaks the resolve)', async () => {
  const addr = '0x000000000000000000000000000000000000bEEF'
  const client = { readContract: async () => { throw new Error('execution reverted') } }
  assert.equal(await tokenSymbol(client, addr), addr)
})

test('a live lookup is cached (one RPC for repeated reads)', async () => {
  const addr = '0x000000000000000000000000000000000000CafE'
  let calls = 0
  const client = { readContract: async () => { calls++; return 'FOO' } }
  assert.equal(await tokenSymbol(client, addr), 'FOO')
  assert.equal(await tokenSymbol(client, addr), 'FOO')
  assert.equal(calls, 1)
})

// ── display wiring (debtToken / collateralAssets show symbols) ───────────────
test('debtToken shows the symbol, not the bare address', async () => {
  const reads = {
    debtAssets: async () => [USDC],
    symbol: async (a) => (a.toLowerCase() === USDC.toLowerCase() ? 'USDC' : a),
  }
  assert.equal(await resolveKey('seikine:debtToken', 'borrow', '0xuser', reads), 'USDC')
})

test('collateralAssets shows vault share symbols, comma-joined', async () => {
  const reads = {
    collateralVaults: async () => ['0xVaultA', '0xVaultB'],
    symbol: async (a) => (a === '0xVaultA' ? 'saWETH-L' : 'saWETH-A'),
  }
  assert.equal(
    await resolveKey('seikine:collateralAssets', 'lend', '0xuser', reads),
    'saWETH-L, saWETH-A',
  )
})

test('empty asset list -> empty string', async () => {
  const reads = { debtAssets: async () => [], symbol: async (a) => a }
  assert.equal(await resolveKey('seikine:debtToken', 'borrow', '0xuser', reads), '')
})
