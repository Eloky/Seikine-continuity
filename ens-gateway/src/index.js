// Seikine ENS gateway — EIP-3668 CCIP-Read service (SKELETON).
//
// SeikinePositionResolver.resolve(name, data) reverts OffchainLookup pointing
// here. This service:
//   1. parses the ENS name (longest-suffix under seikine.eth → subject addr),
//   2. reads the live position over RPC through ISeikineLens.getPosition,
//   3. encodes the requested resolver record (addr / text),
//   4. signs makeSignatureHash(resolver, expires, request, result) with the
//      key in SIGNER_PRIVATE_KEY, and
//   5. returns (result, expires, sig) — which resolveWithProof verifies against
//      the resolver's PUBLIC `signer` address.
//
// The full request/response encoding is completed during the event. Runtime
// logic is stubbed; the wiring + env contract are final.
//
// SECURITY: SIGNER_PRIVATE_KEY lives ONLY in ens-gateway/.env (gitignored).
// Never commit it. Only the matching public address is set on the resolver.

import { createPublicClient, http, parseAbi } from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

const {
  RPC_URL,
  SIGNER_PRIVATE_KEY,
  LENS_ADDRESS,
  RESOLVER_ADDRESS,
  PORT = '8080',
} = process.env

for (const [k, v] of Object.entries({ RPC_URL, SIGNER_PRIVATE_KEY, LENS_ADDRESS, RESOLVER_ADDRESS })) {
  if (!v) throw new Error(`Missing required env var: ${k} (see ens-gateway/README.md)`)
}

// The read surface the gateway consumes — mirrors contracts ISeikineLens.
const lensAbi = parseAbi([
  'function getPosition(address user) view returns ((uint256 collateralUSD,uint256 debtUSD,uint256 maxBorrowUSD,uint256 healthFactorBps,bool liquidatable))',
])

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) })
const signer = privateKeyToAccount(SIGNER_PRIVATE_KEY)

/**
 * Read a subject's live position via the lens (over RPC).
 * @param {`0x${string}`} subject
 */
async function readPosition(subject) {
  return publicClient.readContract({
    address: LENS_ADDRESS,
    abi: lensAbi,
    functionName: 'getPosition',
    args: [subject],
  })
}

// TODO(event): wire @chainlink/ccip-read-server with one handler for
// ISeikineGateway.resolveProfile(address sender, bytes name, bytes data):
//   - decode `name` (DNS-wire) → subject address under seikine.eth
//   - position = await readPosition(subject)
//   - result  = encode the requested record (e.g. text "seikine:health" →
//               formatted healthFactor; addr → subject)
//   - expires = BigInt(Math.floor(Date.now() / 1000) + 300)
//   - sig     = await signer.signMessage / signTypedData over the
//               makeSignatureHash(resolver, expires, request, result) digest
//   - return [result, expires, sig]
//
// The server's URL template is set on the resolver as
//   https://<host>:<PORT>/{sender}/{data}.json

console.log(
  `[seikine-ens-gateway] skeleton ready — signer ${signer.address}, lens ${LENS_ADDRESS}, ` +
  `resolver ${RESOLVER_ADDRESS}, port ${PORT}. Handler wiring completed during the event.`,
)

export { readPosition, signer, publicClient }
