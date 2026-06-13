# seikine-ens-gateway

EIP-3668 CCIP-Read gateway for the `*.seikine.eth` wildcard resolver. It reads
live Seikine positions over RPC through `ISeikineLens` and returns **signed**
resolver responses that [`SeikinePositionResolver`](../contracts/src/SeikinePositionResolver.sol)
verifies on-chain.

## How it fits

```
ENS client ──resolve(alice.seikine.eth)──▶ SeikinePositionResolver
     ▲                                          │ reverts OffchainLookup(url, …)
     │ verified result                          ▼
     └────── resolveWithProof(sig) ◀── this gateway ──readContract──▶ ISeikineLens (RPC)
```

The resolver checks every response against its **public** `signer` address. The
gateway holds the matching **private** key — so the signing key is the one
secret in this system, and it never leaves `.env`.

## Environment (`.env` — gitignored, never commit)

| Var                  | Description                                                        |
| -------------------- | ------------------------------------------------------------------ |
| `RPC_URL`            | Sepolia RPC endpoint the gateway reads through.                    |
| `SIGNER_PRIVATE_KEY` | **Secret.** Signs CCIP-Read responses. Public addr → resolver.     |
| `LENS_ADDRESS`       | Deployed `ISeikineLens` implementation (reads live positions).     |
| `RESOLVER_ADDRESS`   | Deployed `SeikinePositionResolver` (bound into the signature hash).|
| `PORT`               | HTTP port (default `8080`).                                        |

> The resolver only ever stores the signer's **public address**. Generate the
> keypair, put the private key here, and pass the public address as the
> resolver's `signer` constructor arg (done from the gitignored deploy script).

## Run

```bash
npm install
cp <your-secrets> .env   # RPC_URL, SIGNER_PRIVATE_KEY, LENS_ADDRESS, RESOLVER_ADDRESS
npm run dev
```

Status: **skeleton** — env contract, RPC read path, and signer wiring are in
place; the EIP-3668 request handler + record encoding are completed during the
event (see [`docs/demo-runbook.md`](../docs/demo-runbook.md)).
