// Gateway resolution with the claims branch (spec §5, acceptance tests 8–10).
// Drives handleRequest with INJECTED deps — no RPC, no disk, no live store.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, decodeAbiParameters, namehash, recoverAddress } from 'viem'
import { dnsEncode } from '../src/dns.js'
import { makeSigner } from '../src/sign.js'
import {
  handleRequest,
  makeDigest,
  RESOLVER_SERVICE_ABI,
  TEXT_ABI,
  ADDR_COIN_ABI,
} from '../src/handler.js'
import { ACTION_KEYS } from '../src/records.js'

const A = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21'
const RESOLVER = '0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0'
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

// Stub controller reader (fixed values; never touches the network).
const reads = {
  collateralUSD: async () => 90590000000000000000n, // $90.59
  debtUSD: async () => 6480000000000000000n, // $6.48
  healthFactorBps: async () => 111900n,
  collateralVaults: async () => [],
  debtAssets: async () => [],
  symbol: async (a) => a,
}

const baseDeps = {
  resolverAddress: RESOLVER,
  signDigest: async () => '0x' + '11'.repeat(65), // dummy; result-decoding tests
  reads,
  getAddressForLabel: () => null,
  getClaimByHandle: () => null,
}

const claimed = (handle, address, displayName) => ({
  ...baseDeps,
  getClaimByHandle: (h) => (h === handle ? { handle, address, displayName, clean: true } : null),
})

// ── helpers ──────────────────────────────────────────────────────────────────
const textInner = (name, key) =>
  encodeFunctionData({ abi: TEXT_ABI, functionName: 'text', args: [namehash(name), key] })
const addrCoinInner = (name, coin) =>
  encodeFunctionData({ abi: ADDR_COIN_ABI, functionName: 'addr', args: [namehash(name), coin] })
const callDataFor = (name, inner) =>
  encodeFunctionData({ abi: RESOLVER_SERVICE_ABI, functionName: 'resolve', args: [dnsEncode(name), inner] })

async function resolve(name, inner, deps) {
  const body = await handleRequest({ data: callDataFor(name, inner) }, deps)
  const [result, expires, sig] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    body,
  )
  return { result, expires, sig }
}
const asString = (result) => decodeAbiParameters([{ type: 'string' }], result)[0]
const asBytes = (result) => decodeAbiParameters([{ type: 'bytes' }], result)[0]

// ── claimed name (spec §5 step 3, test 8) ────────────────────────────────────
test('claimed name: text("name") returns the display name', async () => {
  const deps = claimed('elian', A, 'Elian')
  const { result } = await resolve('elian.seikine.eth', textInner('elian.seikine.eth', 'name'), deps)
  assert.equal(asString(result), 'Elian')
})

test('claimed name: positions resolve via the existing seikine:* keys', async () => {
  const deps = claimed('elian', A, 'Elian')
  const { result } = await resolve(
    'elian.seikine.eth',
    textInner('elian.seikine.eth', 'seikine:collateralUSD'),
    deps,
  )
  assert.equal(asString(result), '$90.59')
})

test('claimed name: addr(node, 60) resolves to the address', async () => {
  const deps = claimed('elian', A, 'Elian')
  const { result } = await resolve('elian.seikine.eth', addrCoinInner('elian.seikine.eth', 60n), deps)
  assert.equal(asBytes(result).toLowerCase(), A.toLowerCase())
})

// ── unclaimed + reserved (test 9) ────────────────────────────────────────────
test('unclaimed bare label: empty record (name + addr)', async () => {
  const t = await resolve('ghost.seikine.eth', textInner('ghost.seikine.eth', 'name'), baseDeps)
  assert.equal(asString(t.result), '')
  const a = await resolve('ghost.seikine.eth', addrCoinInner('ghost.seikine.eth', 60n), baseDeps)
  assert.equal(asBytes(a.result), '0x')
})

test('reserved bare label never resolves, even if legacy would', async () => {
  const deps = { ...baseDeps, getAddressForLabel: () => A } // would resolve, but reserved wins
  const { result } = await resolve('admin.seikine.eth', textInner('admin.seikine.eth', 'name'), deps)
  assert.equal(asString(result), '')
})

// ── legacy fallback still works (test 10) ────────────────────────────────────
test('legacy/seed label still resolves positions through the fallback', async () => {
  const deps = { ...baseDeps, getAddressForLabel: (l) => (l === 'alice' ? A : null) }
  const { result } = await resolve(
    'alice.seikine.eth',
    textInner('alice.seikine.eth', 'seikine:debtUSD'),
    deps,
  )
  assert.equal(asString(result), '$6.48')
})

// ── legacy direct 0x-address label (spec §5 step 4, test 10) ─────────────────
test('legacy 0x-address label resolves to that address + its positions', async () => {
  const name = `${A.toLowerCase()}.seikine.eth` // address used directly as the label
  const a = await resolve(name, addrCoinInner(name, 60n), baseDeps)
  assert.equal(asBytes(a.result).toLowerCase(), A.toLowerCase())
  const t = await resolve(name, textInner(name, 'seikine:collateralUSD'), baseDeps)
  assert.equal(asString(t.result), '$90.59')
})

// ── gap guard (handoff §4): claimed-handle positions == legacy-address positions ─
// The handle is meant to front BOTH the address and the position identity, so the
// six seikine:* keys must resolve identically through a claimed handle and through
// the legacy <0xADDR>.seikine.eth path (both keyed on the same address).
test('claimed handle serves the same six seikine:* keys as the legacy address path', async () => {
  // reads where every one of the six keys yields a NON-empty value.
  const richReads = {
    collateralUSD: async () => 90590000000000000000n, // $90.59
    debtUSD: async () => 6480000000000000000n, // $6.48
    healthFactorBps: async () => 111900n, // 11.19x
    collateralVaults: async () => ['0x000000000000000000000000000000000000A001'],
    debtAssets: async () => ['0x000000000000000000000000000000000000D001'],
    symbol: async (a) =>
      a.toLowerCase() === '0x000000000000000000000000000000000000a001' ? 'saWETH-L' : 'USDC',
  }
  const handle = 'elian'
  const claimedName = `${handle}.seikine.eth`
  const legacyName = `${A.toLowerCase()}.seikine.eth` // address used directly as the label

  const depsClaimed = {
    ...baseDeps,
    reads: richReads,
    getClaimByHandle: (h) => (h === handle ? { handle, address: A, displayName: 'Elian', clean: true } : null),
  }
  const depsLegacy = { ...baseDeps, reads: richReads } // no claim; the 0x-label resolves to A

  // Enumerate the six keys from the source of truth, not a hardcoded guess.
  const sixKeys = [...ACTION_KEYS.lend, ...ACTION_KEYS.borrow]
  assert.equal(sixKeys.length, 6)

  for (const key of sixKeys) {
    const onHandle = asString((await resolve(claimedName, textInner(claimedName, key), depsClaimed)).result)
    const onAddr = asString((await resolve(legacyName, textInner(legacyName, key), depsLegacy)).result)
    assert.equal(onHandle, onAddr, `parity for ${key}`)
    assert.notEqual(onHandle, '', `${key} must be non-empty`)
  }

  // Identity: addr(60) == A and text("name") == the claim's display name.
  const addrRes = await resolve(claimedName, addrCoinInner(claimedName, 60n), depsClaimed)
  assert.equal(asBytes(addrRes.result).toLowerCase(), A.toLowerCase())
  const nameRes = await resolve(claimedName, textInner(claimedName, 'name'), depsClaimed)
  assert.equal(asString(nameRes.result), 'Elian')
})

// ── signing integrity (test 12, offline) — proves addr() didn't break signing ─
test('response signature recovers to the signer for an addr() query', async () => {
  const { signDigest, address } = makeSigner(TEST_PK)
  const deps = { ...claimed('elian', A, 'Elian'), signDigest }
  const callData = callDataFor('elian.seikine.eth', addrCoinInner('elian.seikine.eth', 60n))
  const body = await handleRequest({ data: callData }, deps)
  const [result, expires, sig] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    body,
  )
  const digest = makeDigest(RESOLVER, expires, callData, result)
  const recovered = await recoverAddress({ hash: digest, signature: sig })
  assert.equal(recovered.toLowerCase(), address.toLowerCase())
})
