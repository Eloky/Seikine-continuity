// Test 2 — signature recovery (offline). Proves the gateway signs what the
// resolver's on-chain ecrecover will accept: recover(digest, sig) == signer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keccak256, toHex, recoverAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { makeSigner } from '../src/sign.js'

const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

test('signDigest produces a 65-byte sig that recovers to the signer address', async () => {
  const { signDigest, address } = makeSigner(TEST_PK)
  const digest = keccak256(toHex('seikine-ens-gateway'))

  const sig = await signDigest(digest)
  assert.equal(sig.length, 132, '0x + 65 bytes')

  const recovered = await recoverAddress({ hash: digest, signature: sig })
  assert.equal(recovered.toLowerCase(), address.toLowerCase())
  assert.equal(recovered.toLowerCase(), privateKeyToAccount(TEST_PK).address.toLowerCase())
})
