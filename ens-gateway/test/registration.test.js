// Tier-2 live registration — validation, persistence, seed protection, the HTTP
// route, and the decisive end-to-end: a freshly-registered name resolves through
// the UNCHANGED signing path.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeFunctionData, decodeAbiParameters } from 'viem'
import { registerName, getAddressForLabel, _reload } from '../src/names.js'
import { createApp } from '../src/app.js'
import { makeSigner } from '../src/sign.js'
import { RESOLVER_SERVICE_ABI, TEXT_ABI } from '../src/handler.js'
import { dnsEncode } from '../src/dns.js'

const RESOLVER = '0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0'
const ALICE = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21'
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

// Fresh temp store per test so we never touch the real data/names.json.
beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'seikine-names-'))
  _reload()
})

const MOCK_READS = {
  collateralUSD: async () => 90590000000000000000n,
  debtUSD: async () => 6480000000000000000n, // $6.48
  healthFactorBps: async () => 111900n,
  collateralVaults: async () => [],
  debtAssets: async () => [],
  symbol: async (a) => a,
}

function buildCallData(ensName, key) {
  const inner = encodeFunctionData({
    abi: TEXT_ABI, functionName: 'text', args: ['0x' + 'ab'.repeat(32), key],
  })
  return encodeFunctionData({
    abi: RESOLVER_SERVICE_ABI, functionName: 'resolve', args: [dnsEncode(ensName), inner],
  })
}
function decodeValue(responseData) {
  const [result] = decodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }], responseData,
  )
  return decodeAbiParameters([{ type: 'string' }], result)[0]
}

// ── 1. validation ───────────────────────────────────────────────────────────
test('rejects bad address, reserved names, duplicates, malformed names', () => {
  assert.ok(registerName('carol', 'not-an-address').error, 'bad address')
  assert.ok(registerName('lend', ALICE).error, 'reserved action word')
  assert.ok(registerName('borrow', ALICE).error, 'reserved action word')
  assert.ok(registerName('alice', ALICE).error, 'reserved seed name')
  assert.ok(registerName('BAD NAME!', ALICE).error, 'malformed')
  assert.ok(registerName('toolongname-aaaaaaaaaaaaaaaaaaaaaaaaaaa', ALICE).error, '>32 chars')

  const ok = registerName('bob', ALICE)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.names, ['bob.seikine.eth', 'lend.bob.seikine.eth', 'borrow.bob.seikine.eth'])

  assert.ok(registerName('bob', ALICE).error, 'duplicate rejected (first-come-first-served)')
})

// ── 2. persistence ──────────────────────────────────────────────────────────
test('registration persists across a reload (write-through file)', () => {
  registerName('bob', ALICE)
  assert.equal(getAddressForLabel('bob'), ALICE)
  _reload() // simulate a container restart: drop cache, re-read the file
  assert.equal(getAddressForLabel('bob'), ALICE, 'survived reload')
})

// ── 3. seed protection ──────────────────────────────────────────────────────
test('seed (alice) always wins and cannot be hijacked', () => {
  assert.equal(getAddressForLabel('alice'), ALICE)
  registerName('bob', '0x000000000000000000000000000000000000dEaD')
  assert.equal(getAddressForLabel('alice'), ALICE, 'seed still wins after registrations')
  assert.ok(registerName('alice', '0x000000000000000000000000000000000000dEaD').error, 'cannot re-register alice')
})

// ── 4. HTTP route + CORS ────────────────────────────────────────────────────
test('POST /register: 200 on valid, 400 on invalid; OPTIONS preflight ok', async () => {
  const { signDigest } = makeSigner(TEST_PK)
  const app = createApp({ resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel })
  const server = app.listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}`

    const okRes = await fetch(base + '/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bob', address: ALICE }),
    })
    assert.equal(okRes.status, 200)
    const okJson = await okRes.json()
    assert.equal(okJson.ok, true)
    assert.ok(okJson.names.includes('borrow.bob.seikine.eth'))

    const badRes = await fetch(base + '/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'lend', address: ALICE }),
    })
    assert.equal(badRes.status, 400)
    assert.ok((await badRes.json()).error)

    const opt = await fetch(base + '/register', { method: 'OPTIONS' })
    assert.equal(opt.status, 204)
    assert.equal(opt.headers.get('access-control-allow-origin'), '*')
  } finally {
    server.close()
  }
})

// ── GET / serves the self-served claim form ─────────────────────────────────
test('GET / serves the claim form (replaces "Cannot GET /")', async () => {
  const { signDigest } = makeSigner(TEST_PK)
  const app = createApp({ resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel })
  const server = app.listen(0)
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') || '', /html/)
    const body = await res.text()
    assert.match(body, /Claim a/)
    assert.match(body, /\/register/)
  } finally {
    server.close()
  }
})

// ── 5. end-to-end: freshly-registered name resolves through the signing path ─
test('register bob -> borrow.bob.seikine.eth/debtUSD resolves "$6.48"', async () => {
  const { signDigest } = makeSigner(TEST_PK)
  const app = createApp({ resolverAddress: RESOLVER, signDigest, reads: MOCK_READS, getAddressForLabel })
  const server = app.listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}`

    // claim bob -> alice's address (so it maps to a real position)
    const reg = await (await fetch(base + '/register', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bob', address: ALICE }),
    })).json()
    assert.equal(reg.ok, true)

    // resolve through the unchanged CCIP path
    const res = await (await fetch(base + '/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender: RESOLVER, data: buildCallData('borrow.bob.seikine.eth', 'seikine:debtUSD') }),
    })).json()
    assert.equal(decodeValue(res.data), '$6.48')
  } finally {
    server.close()
  }
})
