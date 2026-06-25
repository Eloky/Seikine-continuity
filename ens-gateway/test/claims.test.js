// Claims store + handle derivation (spec §2/§3/§7, acceptance tests 1–7).
// Pure derivation tests need no store; claim()/preview() tests use an isolated
// temp DATA_DIR so the suite never touches real registration data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deriveHandle,
  claim,
  preview,
  getClaimByHandle,
  normalizeLabel,
  sanitizeDisplayName,
  _reload,
} from '../src/claims.js'

// Addresses chosen for predictable hex tails.
const A = '0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21' // last4 "2a21"
const B = '0x1111111111111111111111111111111111111111' // last4 "1111"
const P = '0x' + '0'.repeat(36) + 'aaaa' // last4 "aaaa", last6 "00aaaa"
const Q = '0x' + '0'.repeat(34) + '11aaaa' // last4 "aaaa", last6 "11aaaa"
const noLegacy = { legacyLookup: () => null }

// Fresh, isolated store for each stateful scenario.
function reset() {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'seikine-claims-'))
  _reload()
}

// ── deriveHandle (pure, spec §2 — tests 1–4 + step-7 edge) ───────────────────
test('deriveHandle: free base -> clean handle (test 1)', () => {
  const d = deriveHandle('Elian', A, { handleExists: () => false, handleOwner: () => null })
  assert.deepEqual(d, { valid: true, handle: 'elian', base: 'elian', clean: true })
})

test('deriveHandle: taken base -> -last4, not clean (test 2)', () => {
  const taken = new Set(['elian'])
  const d = deriveHandle('Elian', A, {
    handleExists: (h) => taken.has(h),
    handleOwner: (h) => (h === 'elian' ? B.toLowerCase() : null),
  })
  assert.equal(d.handle, 'elian-2a21')
  assert.equal(d.clean, false)
})

test('deriveHandle: same last4, different address -> -last6 (test 3)', () => {
  const taken = new Set(['elian', 'elian-aaaa'])
  const owners = { elian: A.toLowerCase(), 'elian-aaaa': P.toLowerCase() }
  const d = deriveHandle('Elian', Q, {
    handleExists: (h) => taken.has(h),
    handleOwner: (h) => owners[h] ?? null,
  })
  assert.equal(d.handle, 'elian-11aaaa')
})

test('deriveHandle: reserved base is never clean (test 4)', () => {
  const d = deriveHandle('admin', A, { handleExists: () => false, handleOwner: () => null })
  assert.equal(d.clean, false)
  assert.equal(d.handle, 'admin-2a21')
})

// ── claim()/getClaimByHandle (store, spec §3 — tests 1,2,5) ──────────────────
test('claim: first claimant gets the clean handle, resolves to address (test 1)', () => {
  reset()
  const r = claim('Elian', A, noLegacy)
  assert.equal(r.ok, true)
  assert.equal(r.handle, 'elian')
  assert.equal(r.clean, true)
  assert.equal(r.name, 'elian.seikine.eth')
  assert.equal(r.displayName, 'Elian')
  assert.equal(getClaimByHandle('elian').address, A) // checksummed
})

test('claim: second claimant of a base is auto-suffixed (test 2)', () => {
  reset()
  claim('Elian', A, noLegacy)
  const r = claim('Elian', B, noLegacy)
  assert.equal(r.handle, 'elian-1111')
  assert.equal(r.clean, false)
  assert.equal(getClaimByHandle('elian-1111').address, B)
  assert.equal(getClaimByHandle('elian').address, A) // first claim untouched
})

test('claim: re-claim by same address keeps the frozen handle, updates displayName (test 5)', () => {
  reset()
  claim('Elian', A, noLegacy)
  const r = claim('Bob', A, noLegacy)
  assert.equal(r.handle, 'elian') // frozen
  assert.equal(r.displayName, 'Bob') // updated
  assert.equal(getClaimByHandle('elian').displayName, 'Bob')
})

test('claim: legacy/seed name is never shadowed by a clean handle (spec §1)', () => {
  reset()
  const r = claim('Alice', A, { legacyLookup: (h) => (h === 'alice' ? B : null) })
  assert.equal(r.clean, false)
  assert.equal(r.handle, 'alice-2a21')
})

test('claim: reserved base is always suffixed (test 4)', () => {
  reset()
  const r = claim('admin', A, noLegacy)
  assert.equal(r.clean, false)
  assert.equal(r.handle, 'admin-2a21')
})

// ── normalization (spec §7 — test 6, the #1-risk round-trip) ─────────────────
test('claim: unicode label normalizes identically and round-trips (test 6)', () => {
  reset()
  const r = claim('Café', A, noLegacy)
  assert.equal(r.ok, true)
  assert.equal(r.base, normalizeLabel('CAFÉ')) // same normal form regardless of input case
  assert.equal(normalizeLabel(r.handle), r.handle) // stored handle == normalize(handle)
  assert.ok(getClaimByHandle(normalizeLabel('café'))) // resolves via the normalized key
})

test('claim: unnormalizable label is rejected and stores nothing (test 7)', () => {
  reset()
  const r = claim('a_b', A, noLegacy) // mid-label underscore is invalid per ENSIP-15
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'unnormalizable')
  assert.equal(getClaimByHandle('a_b'), null)
})

// ── preview (spec §4 — never "taken") ────────────────────────────────────────
test('preview: free base without an address -> clean, handle == base', () => {
  reset()
  assert.deepEqual(preview('Elian', undefined, noLegacy), {
    valid: true,
    displayName: 'Elian',
    handle: 'elian',
    clean: true,
  })
})

test('preview: taken base is never an error — yields a suffixed handle', () => {
  reset()
  claim('Elian', A, noLegacy)
  const p = preview('Elian', B, noLegacy)
  assert.equal(p.valid, true)
  assert.equal(p.handle, 'elian-1111')
  assert.equal(p.clean, false)
})

test('preview: validation reasons', () => {
  reset()
  assert.deepEqual(preview('ab', A, noLegacy), { valid: false, reason: 'too_long' })
  assert.deepEqual(preview('a.b', A, noLegacy), { valid: false, reason: 'multi_label' })
  assert.equal(preview('', A, noLegacy).valid, false)
})

// ── display-name sanitization (spec §7 display path) ─────────────────────────
test('sanitizeDisplayName trims and strips control chars', () => {
  assert.equal(sanitizeDisplayName('  Elian  '), 'Elian')
  assert.equal(sanitizeDisplayName('El' + String.fromCharCode(9) + 'ian'), 'Elian') // tab
  assert.equal(sanitizeDisplayName('a' + String.fromCharCode(127) + 'b'), 'ab') // DEL
})
