// Express layer — POST / and GET /health over real HTTP, fully offline.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, decodeAbiParameters } from 'viem'
import { createApp } from '../src/app.js'
import { makeSigner } from '../src/sign.js'
import { getAddressForLabel } from '../src/names.js'
import { RESOLVER_SERVICE_ABI, TEXT_ABI } from '../src/handler.js'
import { dnsEncode } from '../src/dns.js'

const RESOLVER = '0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0'
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const reads = {
  collateralUSD: async () => 90590000000000000000n,
  debtUSD: async () => 6480000000000000000n,
  healthFactorBps: async () => 111900n,
  collateralVaults: async () => [],
  debtAssets: async () => [],
}

function appWithMocks() {
  const { signDigest } = makeSigner(TEST_PK)
  return createApp({ resolverAddress: RESOLVER, signDigest, reads, getAddressForLabel })
}

function callData(ensName, key) {
  const inner = encodeFunctionData({
    abi: TEXT_ABI, functionName: 'text', args: ['0x' + 'ab'.repeat(32), key],
  })
  return encodeFunctionData({
    abi: RESOLVER_SERVICE_ABI, functionName: 'resolve', args: [dnsEncode(ensName), inner],
  })
}

test('POST / returns a signed EIP-3668 body decoding to the value', async () => {
  const server = appWithMocks().listen(0)
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: RESOLVER, data: callData('borrow.alice.seikine.eth', 'seikine:debtUSD') }),
    })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('access-control-allow-origin'), '*', 'CORS so a browser can read the CCIP response')
    const json = await res.json()
    assert.ok(typeof json.data === 'string' && json.data.startsWith('0x'))
    const [result] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }], json.data,
    )
    const [value] = decodeAbiParameters([{ type: 'string' }], result)
    assert.equal(value, '$6.48')
  } finally {
    server.close()
  }
})

test('OPTIONS / preflight -> 204 with CORS headers (browser CCIP-Read)', async () => {
  const server = appWithMocks().listen(0)
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://frontend.example', 'Access-Control-Request-Method': 'POST' },
    })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.match(res.headers.get('access-control-allow-methods') || '', /POST/)
    assert.match(res.headers.get('access-control-allow-headers') || '', /Content-Type/i)
  } finally {
    server.close()
  }
})

test('POST / with no data -> 400', async () => {
  const server = appWithMocks().listen(0)
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: RESOLVER }),
    })
    assert.equal(res.status, 400)
  } finally {
    server.close()
  }
})

test('GET /health -> { ok: true }', async () => {
  const server = appWithMocks().listen(0)
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  } finally {
    server.close()
  }
})
