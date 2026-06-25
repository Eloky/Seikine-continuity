// In-app claim HTTP routes (/preview, /claim) over real HTTP, fully offline.
// Isolated temp DATA_DIR per test so the suite never touches real claim data.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { makeSigner } from '../src/sign.js'
import { getAddressForLabel } from '../src/names.js'
import { _reload } from '../src/claims.js'

const RESOLVER = '0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0'
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const A = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21' // last4 "2a21"
const B = '0x1111111111111111111111111111111111111111' // last4 "1111"
const C = '0x3333333333333333333333333333333333333333' // fresh (for the 400 case)

const reads = {
  collateralUSD: async () => 0n,
  debtUSD: async () => 0n,
  healthFactorBps: async () => 0n,
  collateralVaults: async () => [],
  debtAssets: async () => [],
  symbol: async (a) => a,
}

beforeEach(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'seikine-claim-ep-'))
  _reload()
})

function appWithMocks() {
  const { signDigest } = makeSigner(TEST_PK)
  return createApp({ resolverAddress: RESOLVER, signDigest, reads, getAddressForLabel })
}

test('GET /preview validates a free base (clean) without an address', async () => {
  const server = appWithMocks().listen(0)
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/preview?label=Elian`)
    assert.equal(res.status, 200)
    const j = await res.json()
    assert.equal(j.valid, true)
    assert.equal(j.handle, 'elian')
    assert.equal(j.clean, true)
  } finally {
    server.close()
  }
})

test('POST /claim: issues a handle, suffixes the next address, 400 on unnormalizable', async () => {
  const server = appWithMocks().listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const post = (body) =>
      fetch(base + '/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const j1 = await (await post({ label: 'Elian', address: A })).json()
    assert.equal(j1.ok, true)
    assert.equal(j1.handle, 'elian')
    assert.equal(j1.name, 'elian.seikine.eth')
    assert.equal(j1.clean, true)

    const j2 = await (await post({ label: 'Elian', address: B })).json()
    assert.equal(j2.handle, 'elian-1111')
    assert.equal(j2.clean, false)

    const bad = await post({ label: 'a_b', address: C }) // fresh address -> derivation runs
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).reason, 'unnormalizable')
  } finally {
    server.close()
  }
})

test('GET /claim?address= and ?handle= read the by_address / by_handle indexes', async () => {
  const server = appWithMocks().listen(0)
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    await fetch(base + '/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Elian', address: A }),
    })

    const byAddr = await (await fetch(base + `/claim?address=${A}`)).json()
    assert.equal(byAddr.claimed, true)
    assert.equal(byAddr.handle, 'elian')
    assert.equal(byAddr.name, 'elian.seikine.eth')

    const unclaimed = await (await fetch(base + `/claim?address=${B}`)).json()
    assert.equal(unclaimed.claimed, false)

    const byHandle = await (await fetch(base + `/claim?handle=Elian`)).json() // any case
    assert.equal(byHandle.found, true)
    assert.equal(byHandle.displayName, 'Elian')

    const missing = await (await fetch(base + `/claim?handle=nope`)).json()
    assert.equal(missing.found, false)
  } finally {
    server.close()
  }
})

test('OPTIONS /claim preflight -> 204 with CORS', async () => {
  const server = appWithMocks().listen(0)
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/claim`, { method: 'OPTIONS' })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
  } finally {
    server.close()
  }
})
