// Seikine ENS gateway — EIP-3668 CCIP-Read service.
//
// SeikinePositionResolver.resolve(name, data) reverts OffchainLookup pointing
// here. This service decodes the name, reads the live position from the deployed
// SeikineLendingController over RPC, signs the response with the gateway key, and
// returns the EIP-3668 body the resolver's resolveWithProof verifies on-chain.
//
// SECURITY: GATEWAY_SIGNER_PK lives ONLY in ens-gateway/.env (gitignored) or the
// host's secret env. Never commit it. Only its public address is set on-chain.

import { createApp } from './app.js'
import { makeClient, makeReads } from './controller.js'
import { makeSigner } from './sign.js'
import { getAddressForLabel } from './names.js'

// Load .env when running locally; hosted deploys inject these as real env vars.
try {
  process.loadEnvFile()
} catch {
  /* no .env (hosted) — rely on process.env */
}

const { GATEWAY_SIGNER_PK, RPC_URL, RESOLVER_ADDRESS, CONTROLLER_ADDRESS, PORT = '8080' } =
  process.env

for (const [k, v] of Object.entries({
  GATEWAY_SIGNER_PK,
  RPC_URL,
  RESOLVER_ADDRESS,
  CONTROLLER_ADDRESS,
})) {
  if (!v) throw new Error(`Missing required env var: ${k} (see ens-gateway/README.md)`)
}

const client = makeClient(RPC_URL)
const reads = makeReads(client, CONTROLLER_ADDRESS)
const { signDigest, address } = makeSigner(GATEWAY_SIGNER_PK)

const app = createApp({ resolverAddress: RESOLVER_ADDRESS, signDigest, reads, getAddressForLabel })

app.listen(Number(PORT), () => {
  console.log(
    `[seikine-ens-gateway] listening on :${PORT} — signer ${address}, ` +
      `resolver ${RESOLVER_ADDRESS}, controller ${CONTROLLER_ADDRESS}`,
  )
})
