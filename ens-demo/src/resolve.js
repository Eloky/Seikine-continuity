// Resolve a virtual *.seikine.eth position name end-to-end (SKELETON).
//
// viem follows ENSIP-10 wildcard resolution + EIP-3668 CCIP-Read automatically,
// so a normal getEnsText / getEnsAddress call against a `*.seikine.eth` name
// triggers SeikinePositionResolver → the gateway → a verified response, with no
// per-name record ever written on-chain.
//
// Reads PUBLIC config only (RPC + the name to resolve). No private material.

import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'

const RPC_URL = process.env.RPC_URL ?? 'https://rpc.sepolia.org'
const NAME = process.argv[2] ?? 'alice.seikine.eth'

const client = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
  // CCIP-Read is enabled by default; shown explicitly for the demo.
  ccipRead: undefined,
})

async function main() {
  console.log(`Resolving ${NAME} via the wildcard CCIP-Read resolver…`)

  // The subject address behind the virtual name.
  const address = await client.getEnsAddress({ name: NAME }).catch(() => null)
  console.log('  addr  →', address ?? '(none)')

  // Live position fields, surfaced as ENS text records by the gateway.
  for (const key of ['seikine:health', 'seikine:collateralUSD', 'seikine:debtUSD']) {
    const value = await client.getEnsText({ name: NAME, key }).catch(() => null)
    console.log(`  text  ${key} →`, value ?? '(none)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
