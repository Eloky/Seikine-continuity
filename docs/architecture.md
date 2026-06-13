# Architecture

Seikine is an ETH lending protocol (stake collateral → borrow stablecoins) that
already runs on Sepolia. This repo carries the **public** pieces plus the two
new hackathon features: a Chainlink circuit breaker on the controller, and a
wildcard ENS resolver that turns any `*.seikine.eth` name into a live position
profile.

## Components

| Component                    | Where                                                | Public? |
| ---------------------------- | ---------------------------------------------------- | ------- |
| Lending controller           | `contracts/src/SeikineLendingController.sol`         | ✅ baseline + breaker host |
| Treasury / vaults / routers  | `contracts/src/private/` (gitignored) via interfaces | ❌ private impl |
| Wildcard position resolver   | `contracts/src/SeikinePositionResolver.sol`          | ✅ new   |
| CCIP-Read gateway            | `ens-gateway/`                                       | ✅ new   |
| ENS registration + resolve   | `ens-demo/`                                          | ✅ new   |
| Frontend (`seikine-app`)     | separate sibling folder, **outside this repo**       | ❌ private |

## Lending + the circuit breaker

The controller exposes the exact surface the frontend reads today: per-user USD
collateral/debt, borrow capacity, and a basis-point health factor, plus the
`CollateralVaultConfig` / `DebtAssetConfig` maps. Every USD-denominated view
prices through Chainlink Data Feeds in `_readPrice` — **the circuit-breaker
seam**. The breaker enforces feed freshness (`maxFeedStaleness`) and a positive,
in-bounds answer, and fails closed by reverting `PriceFeedStale()` (selector
`0x216cc5f5`). The frontend already detects that selector and falls back to a
client-side projection, so a tripped breaker degrades the UI rather than
mispricing collateral.

The controller depends on the treasury and vaults **only through interfaces**
(`ISeikineTreasury`, `ISeikineCollateralVault`), so the public set compiles and
deploys with no private implementation file present.

## ENS: one wildcard resolver, no per-name minting

```
client.resolve(lend.alice.seikine.eth)
        │
        ▼
SeikinePositionResolver.resolve(name, data)     ← set once on seikine.eth
        │  revert OffchainLookup(gatewayUrl, callData, resolveWithProof, …)
        ▼
ens-gateway  ──readContract(getPosition)──▶  ISeikineLens  (live state, RPC)
        │  sign(makeSignatureHash(resolver, expires, request, result))
        ▼
SeikinePositionResolver.resolveWithProof(response)
        │  ecrecover == signer ?  → return result : revert
        ▼
client gets the verified, live position profile
```

- **ENSIP-10 wildcard:** the resolver implements `IExtendedResolver`; one
  resolver on `seikine.eth` answers for every subname by longest-suffix match.
  No subname is ever issued — there is no minting contract and no NameStone.
- **EIP-3668 CCIP-Read:** reads happen off-chain in the gateway, then are
  verified on-chain against the resolver's public `signer`.
- **Trust:** the gateway's signing key is the single secret (in `.env`); the
  chain only ever holds the matching public address.

## Roadmap (not built here)

- Tokenized position-NFTs (per-position ERC-1155 via the v2 registry factory).
- ZK shielded positions (Groth16).
