// Gateway signing. Signs the RAW EIP-191 v0x00 digest (not personal-sign) with
// the gateway key, producing a 65-byte r‖s‖v (v ∈ {27,28}, canonical low-s)
// signature the resolver's on-chain recovery accepts.

import { sign } from 'viem/accounts'
import { privateKeyToAccount } from 'viem/accounts'
import { serializeSignature } from 'viem'

/**
 * @param {`0x${string}`} privateKey gateway signer key (from env; never committed)
 * @returns {{ signDigest: (digest: `0x${string}`) => Promise<`0x${string}`>, address: `0x${string}` }}
 */
export function makeSigner(privateKey) {
  const account = privateKeyToAccount(privateKey)
  const signDigest = async (digest) =>
    serializeSignature(await sign({ hash: digest, privateKey }))
  return { signDigest, address: account.address }
}
