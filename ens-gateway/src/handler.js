// EIP-3668 request handler — done by hand so it matches SeikinePositionResolver
// byte-for-byte. The resolver reverts OffchainLookup(url, callData, ...); the
// client POSTs { sender, data: callData } here; we decode, read, sign, return.

import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  encodePacked,
  parseAbi,
  getAddress,
  zeroAddress,
} from 'viem'
import { dnsDecode, parseLabels } from './dns.js'
import { resolveKey } from './records.js'
import { getClaimByHandle, normalizeLabel, RESERVED } from './claims.js'

// The outer call the resolver encodes (must match contracts IResolverService).
export const RESOLVER_SERVICE_ABI = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes sig)',
])
// The inner record queries we answer. Other selectors -> empty result.
export const TEXT_ABI = parseAbi(['function text(bytes32 node, string key) view returns (string)'])
export const ADDR_ABI = parseAbi(['function addr(bytes32 node) view returns (address)']) // 0x3b3b57de
export const ADDR_COIN_ABI = parseAbi([
  'function addr(bytes32 node, uint256 coinType) view returns (bytes)', // 0xf1cb7e06 (ENSIP-9)
])

export const COIN_TYPE_ETH = 60n
export const TTL_SECONDS = 300

/**
 * The exact digest the resolver verifies:
 *   keccak256(0x1900 ‖ resolver ‖ expires ‖ keccak256(callData) ‖ keccak256(result))
 * `callData` is the RAW request bytes the client POSTed — hash it as-is.
 */
export function makeDigest(resolverAddress, expires, callData, result) {
  return keccak256(
    encodePacked(
      ['bytes2', 'address', 'uint64', 'bytes32', 'bytes32'],
      ['0x1900', resolverAddress, expires, keccak256(callData), keccak256(result)],
    ),
  )
}

/**
 * Resolve the leftmost user label to an identity — claims-first priority ladder
 * (spec §5). Returns { user: addr|null, displayName }. Never throws; an
 * unresolvable label yields an empty record (zero/empty value, NO revert).
 */
function resolveIdentity(userLabel, deps) {
  if (!userLabel) return { user: null, displayName: '' }

  let label
  try {
    label = normalizeLabel(userLabel)
  } catch {
    return { user: null, displayName: '' } // unnormalizable -> empty record
  }

  // 1. A claimed handle wins (its frozen address + cosmetic display name).
  const lookupClaim = deps.getClaimByHandle ?? getClaimByHandle
  const claim = lookupClaim(label)
  if (claim) return { user: claim.address, displayName: claim.displayName ?? '' }

  // 2. Reserved bare bases never resolve on their own.
  if (RESERVED.has(label)) return { user: null, displayName: '' }

  // 3. Legacy direct 0x-address label keeps working (spec §5 step 4).
  if (/^0x[0-9a-f]{40}$/.test(label)) return { user: getAddress(label), displayName: '' }

  // 4. Seed / legacy /register fallback.
  return { user: deps.getAddressForLabel?.(label) ?? null, displayName: '' }
}

/**
 * Decode the inner record query and ABI-encode the answer for THAT record type.
 *   text(node,key) -> abi.encode(string)
 *   addr(node)     -> abi.encode(address)
 *   addr(node,60)  -> abi.encode(bytes)   (empty bytes for other coin types)
 * The signing digest is taken over these `result` bytes regardless of type, so
 * the resolver verifies every record type through the unchanged signing path.
 */
async function buildResult(innerData, { action, user, displayName, reads }) {
  // text(node, key)
  try {
    const inner = decodeFunctionData({ abi: TEXT_ABI, data: innerData })
    if (inner.functionName === 'text') {
      const key = inner.args[1]
      let value = ''
      if (key === 'name') value = displayName || '' // ENSIP-5 display name (claim-only)
      else if (user && key) value = await resolveKey(key, action, user, reads)
      return encodeAbiParameters([{ type: 'string' }], [value])
    }
  } catch {
    /* not a text() call */
  }

  // addr(node, coinType) -> bytes
  try {
    const inner = decodeFunctionData({ abi: ADDR_COIN_ABI, data: innerData })
    if (inner.functionName === 'addr') {
      const coinType = inner.args[1]
      const bytes = coinType === COIN_TYPE_ETH && user ? user : '0x'
      return encodeAbiParameters([{ type: 'bytes' }], [bytes])
    }
  } catch {
    /* not an addr(node,coin) call */
  }

  // addr(node) -> address (legacy single-arg form)
  try {
    const inner = decodeFunctionData({ abi: ADDR_ABI, data: innerData })
    if (inner.functionName === 'addr') {
      return encodeAbiParameters([{ type: 'address' }], [user || zeroAddress])
    }
  } catch {
    /* not an addr(node) call */
  }

  // Unknown selector -> empty string record (prior behavior).
  return encodeAbiParameters([{ type: 'string' }], [''])
}

/**
 * @param {{ data: `0x${string}` }} req  the POSTed body; `data` == callData
 * @param deps { resolverAddress, signDigest, reads, getAddressForLabel, getClaimByHandle }
 * @returns {Promise<`0x${string}`>} the EIP-3668 response body (abi.encode(result,expires,sig))
 */
export async function handleRequest({ data: callData }, deps) {
  const { resolverAddress, signDigest, reads } = deps

  // 1. decode the outer resolve(bytes name, bytes data)
  const { args } = decodeFunctionData({ abi: RESOLVER_SERVICE_ABI, data: callData })
  const [dnsName, innerData] = args

  // 2. DNS-decode the name -> action + user label, 3. label -> identity (claims-first)
  const { action, userLabel } = parseLabels(dnsDecode(dnsName))
  const { user, displayName } = resolveIdentity(userLabel, deps)

  // 4. decode the inner query + encode the answer for its record type
  const result = await buildResult(innerData, { action, user, displayName, reads })

  // 5. sign the exact digest, encode the response (signing path UNCHANGED)
  const expires = BigInt(Math.floor(Date.now() / 1000) + TTL_SECONDS)
  const digest = makeDigest(resolverAddress, expires, callData, result)
  const sig = await signDigest(digest)
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    [result, expires, sig],
  )
}
