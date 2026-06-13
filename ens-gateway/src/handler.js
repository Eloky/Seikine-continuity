// EIP-3668 request handler — done by hand so it matches SeikinePositionResolver
// byte-for-byte. The resolver reverts OffchainLookup(url, callData, ...); the
// client POSTs { sender, data: callData } here; we decode, read, sign, return.

import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  encodePacked,
  parseAbi,
} from 'viem'
import { dnsDecode, parseLabels } from './dns.js'
import { resolveKey } from './records.js'

// The outer call the resolver encodes (must match contracts IResolverService).
export const RESOLVER_SERVICE_ABI = parseAbi([
  'function resolve(bytes name, bytes data) view returns (bytes result, uint64 expires, bytes sig)',
])
// The inner record query we answer. Other selectors -> empty result.
export const TEXT_ABI = parseAbi(['function text(bytes32 node, string key) view returns (string)'])

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
 * @param {{ data: `0x${string}` }} req  the POSTed body; `data` == callData
 * @param deps { resolverAddress, signDigest, reads, getAddressForLabel }
 * @returns {Promise<`0x${string}`>} the EIP-3668 response body (abi.encode(result,expires,sig))
 */
export async function handleRequest({ data: callData }, deps) {
  const { resolverAddress, signDigest, reads, getAddressForLabel } = deps

  // 1. decode the outer resolve(bytes name, bytes data)
  const { args } = decodeFunctionData({ abi: RESOLVER_SERVICE_ABI, data: callData })
  const [dnsName, innerData] = args

  // 2. DNS-decode the name -> action + user label, 3. label -> address
  const { action, userLabel } = parseLabels(dnsDecode(dnsName))
  const user = getAddressForLabel(userLabel)

  // 4. decode the inner query (we answer text(bytes32 node, string key))
  let key = null
  try {
    const inner = decodeFunctionData({ abi: TEXT_ABI, data: innerData })
    if (inner.functionName === 'text') key = inner.args[1]
  } catch {
    key = null // non-text selector (e.g. addr) -> empty result
  }

  // 5. resolve the value (action-gated + graceful degradation), 6. encode as text() -> string
  const value = user && key ? await resolveKey(key, action, user, reads) : ''
  const result = encodeAbiParameters([{ type: 'string' }], [value])

  // 7. sign the exact digest, encode the response
  const expires = BigInt(Math.floor(Date.now() / 1000) + TTL_SECONDS)
  const digest = makeDigest(resolverAddress, expires, callData, result)
  const sig = await signDigest(digest)
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'uint64' }, { type: 'bytes' }],
    [result, expires, sig],
  )
}
