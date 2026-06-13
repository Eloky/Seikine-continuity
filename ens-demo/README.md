# ens-demo

Two small surfaces over the live `*.seikine.eth` wildcard resolver — **public
addresses only, nothing minted per name.**

- **`scripts/`** — ens-cli sequences that register `seikine.eth` and point it at the
  deployed `SeikinePositionResolver` (`01-register-seikine-eth.sh`,
  `02-set-resolver.sh`). ens-cli builds the calldata; the owner's wallet signs — no
  private keys. See [`scripts/README.md`](scripts/README.md).
- **`src/resolve.js`** — a viem resolution surface. viem follows ENSIP-10 wildcard
  resolution + EIP-3668 CCIP-Read automatically, so a plain `getEnsText` /
  `getEnsAddress` against a `*.seikine.eth` name drives the resolver → gateway →
  verified-response path:
  ```bash
  npm install
  npm run resolve -- alice.seikine.eth   # RPC_URL optional; defaults to https://rpc.sepolia.org
  # → addr + live seikine:health / seikine:collateralUSD / seikine:debtUSD
  ```

For the off-chain half — the signed CCIP-Read response the resolver verifies
on-chain — see the gateway README:
[`../ens-gateway/README.md`](../ens-gateway/README.md).
