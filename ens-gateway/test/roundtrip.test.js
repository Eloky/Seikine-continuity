// Test 3 — full EIP-3668 round-trip. The decisive proof: the gateway signs
// EXACTLY what the resolver verifies, and the value is correctly formatted.
//
// Offline by default (mock controller reads + a test signer). A LIVE block runs
// only when RPC_URL is set, asserting against the deployed controller + the real
// gateway key (Elian's smoke test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, decodeAbiParameters, recoverAddress, getAddress } from 'viem'
import { handleRequest, RESOLVER_SERVICE_ABI, TEXT_ABI, makeDigest } from '../src/handler.js'
import { makeReads } from '../src/controller.js'
import { makeClient } from '../src/controller.js'
import { makeSigner } from '../src/sign.js'
import { getAddressForLabel } from '../src/names.js'
import { dnsEncode } from '../src/dns.js'

const RESOLVER = '0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0'
const ALICE = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21'
const GATEWAY_SIGNER = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21' // resolver-registered signer
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

// Build a real client request: encode the inner text() call, wrap in resolve(name,data).
function buildCallData(ensName, key) {
  const inner = encodeFunctionData({
    abi: TEXT_ABI,
    functionName: 'text',
    args: ['0x' + 'ab'.repeat(32), key], // node is opaque to the gateway
  })
  return encodeFunctionData({
    abi: RESOLVER_SERVICE_ABI,
    functionName: 'resolve',
    args: [dnsEncode(ensName), inner],
  })
}

function decodeResponse(responseData) {
  const [result, expires, sig] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    responseData,
  )
  const [value] = decodeAbiParameters([{ type: 'string' }], result)
  return { result, expires, sig, value }
}

const MOCK_READS = {
  collateralUSD: async () => 90590000000000000000n, // $90.59
  debtUSD: async () => 6480000000000000000n, // $6.48
  healthFactorBps: async () => 111900n, // 11.19x
  collateralVaults: async () => [],
  debtAssets: async () => [],
}

test('round-trip: borrow.alice debtUSD -> "$6.48", signature recovers to signer', async () => {
  const { signDigest, address } = makeSigner(TEST_PK)
  const deps = { resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel }

  const callData = buildCallData('borrow.alice.seikine.eth', 'seikine:debtUSD')
  const responseData = await handleRequest({ data: callData }, deps)

  const { result, expires, sig, value } = decodeResponse(responseData)
  assert.equal(value, '$6.48', 'formatted debt')

  // The resolver recomputes this exact digest from (resolver, expires, callData, result).
  const digest = makeDigest(RESOLVER, expires, callData, result)
  const recovered = await recoverAddress({ hash: digest, signature: sig })
  assert.equal(getAddress(recovered), getAddress(address), 'sig recovers to gateway signer')
})

test('round-trip: lend.alice collateralUSD -> "$90.59"', async () => {
  const { signDigest } = makeSigner(TEST_PK)
  const deps = { resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel }
  const callData = buildCallData('lend.alice.seikine.eth', 'seikine:collateralUSD')
  const { value } = decodeResponse(await handleRequest({ data: callData }, deps))
  assert.equal(value, '$90.59')
})

test('grammar: healthFactor is borrow-only -> empty on lend.<user>', async () => {
  const { signDigest } = makeSigner(TEST_PK)
  const deps = { resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel }
  const callData = buildCallData('lend.alice.seikine.eth', 'seikine:healthFactor')
  const { value } = decodeResponse(await handleRequest({ data: callData }, deps))
  assert.equal(value, '', 'out-of-grammar key returns empty')
})

test('unknown label -> empty value (still a valid signed response)', async () => {
  const { signDigest } = makeSigner(TEST_PK)
  const deps = { resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel }
  const callData = buildCallData('borrow.nobody.seikine.eth', 'seikine:debtUSD')
  const { value, sig } = decodeResponse(await handleRequest({ data: callData }, deps))
  assert.equal(value, '')
  assert.equal(sig.length, 132, 'still signed')
})

// ── LIVE smoke test (Elian) — runs only with RPC_URL set ────────────────────
const live = Boolean(process.env.RPC_URL && process.env.GATEWAY_SIGNER_PK)
test('LIVE: borrow.alice debtUSD against the deployed controller', { skip: !live }, async () => {
  const client = makeClient(process.env.RPC_URL)
  const reads = makeReads(client, process.env.CONTROLLER_ADDRESS ?? '0xaAb9801E5f3a0789BC272f24250b16Cc1975527A')
  const { signDigest } = makeSigner(process.env.GATEWAY_SIGNER_PK)
  const deps = { resolverAddress: RESOLVER, signDigest, reads, getAddressForLabel }

  const callData = buildCallData('borrow.alice.seikine.eth', 'seikine:debtUSD')
  const responseData = await handleRequest({ data: callData }, deps)
  const { result, expires, sig, value } = decodeResponse(responseData)
  console.log('LIVE borrow.alice debtUSD =', value)

  const recovered = await recoverAddress({ hash: makeDigest(RESOLVER, expires, callData, result), signature: sig })
  assert.equal(getAddress(recovered), getAddress(GATEWAY_SIGNER), 'recovers to the registered gateway signer')
})
