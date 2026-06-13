// DNS-wire name codec + Seikine label grammar. No deps beyond viem's hex utils.
//
// An ENS name arrives DNS-wire-encoded: each label is a length byte followed by
// that many UTF-8 bytes, terminated by a zero byte. `lend.alice.seikine.eth` ->
// 04 'lend' 05 'alice' 07 'seikine' 03 'eth' 00.

import { bytesToHex, hexToBytes } from 'viem'

/** Encode a dotted ENS name to DNS-wire hex (used by tests/clients). */
export function dnsEncode(name) {
  const out = []
  for (const label of name.split('.').filter(Boolean)) {
    const b = new TextEncoder().encode(label)
    if (b.length > 255) throw new Error(`label too long: ${label}`)
    out.push(b.length, ...b)
  }
  out.push(0)
  return bytesToHex(Uint8Array.from(out))
}

/** Decode DNS-wire hex (or bytes) to an array of labels. */
export function dnsDecode(dnsName) {
  const bytes = typeof dnsName === 'string' ? hexToBytes(dnsName) : dnsName
  const labels = []
  let i = 0
  while (i < bytes.length) {
    const len = bytes[i]
    if (len === 0) break
    labels.push(new TextDecoder().decode(bytes.slice(i + 1, i + 1 + len)))
    i += 1 + len
  }
  return labels
}

const ACTIONS = new Set(['lend', 'borrow'])

/**
 * Split labels (under `seikine.eth`) into an optional action + the user label.
 *   ['lend','alice','seikine','eth']  -> { action:'lend',   userLabel:'alice' }
 *   ['borrow','alice','seikine','eth']-> { action:'borrow', userLabel:'alice' }
 *   ['alice','seikine','eth']         -> { action:undefined,userLabel:'alice' }
 */
export function parseLabels(labels) {
  let sub = labels
  const n = labels.length
  if (n >= 2 && labels[n - 2].toLowerCase() === 'seikine' && labels[n - 1].toLowerCase() === 'eth') {
    sub = labels.slice(0, n - 2)
  }
  if (sub.length === 0) return { action: undefined, userLabel: undefined }
  if (sub.length >= 2 && ACTIONS.has(sub[0].toLowerCase())) {
    return { action: sub[0].toLowerCase(), userLabel: sub[1] }
  }
  // No recognized action prefix: the closest label to seikine.eth is the user.
  return { action: undefined, userLabel: sub[sub.length - 1] }
}
