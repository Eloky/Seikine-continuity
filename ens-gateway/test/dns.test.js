// Test 1 — name parsing (offline).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dnsEncode, dnsDecode, parseLabels } from '../src/dns.js'

test('dnsEncode -> dnsDecode round-trips to labels', () => {
  assert.deepEqual(dnsDecode(dnsEncode('lend.alice.seikine.eth')), [
    'lend', 'alice', 'seikine', 'eth',
  ])
})

test('parseLabels: lend.alice -> {lend, alice}', () => {
  assert.deepEqual(parseLabels(['lend', 'alice', 'seikine', 'eth']), {
    action: 'lend', userLabel: 'alice',
  })
})

test('parseLabels: borrow.alice -> {borrow, alice}', () => {
  assert.deepEqual(parseLabels(['borrow', 'alice', 'seikine', 'eth']), {
    action: 'borrow', userLabel: 'alice',
  })
})

test('parseLabels: alice (no action) -> {undefined, alice}', () => {
  assert.deepEqual(parseLabels(['alice', 'seikine', 'eth']), {
    action: undefined, userLabel: 'alice',
  })
})

test('parseLabels: unknown prefix falls back to user label, no action', () => {
  assert.deepEqual(parseLabels(['x', 'alice', 'seikine', 'eth']), {
    action: undefined, userLabel: 'alice',
  })
})
