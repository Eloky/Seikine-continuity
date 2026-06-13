# Seikine Continuity

Seikine is an ETH lending protocol on Sepolia — stake collateral, borrow
stablecoins, track your position. This repo holds the **public** pieces of
Seikine plus two new features built for the hackathon (June 12–14, 2026):

1. **A Chainlink Data Feeds circuit breaker** on the lending controller — price
   reads fail closed instead of pricing collateral off a stale or manipulated
   feed.
2. **A wildcard ENS resolver** — any `*.seikine.eth` name resolves to a live,
   on-chain-verified position profile via CCIP-Read, with **nothing minted per
   name**.

## New vs. reused

| Status | Piece | Where |
| ------ | ----- | ----- |
| **Reused · private** | Seikine core: treasury, vaults, routers, liquidation, lens impl | `contracts/src/private/` (gitignored) + reached via interfaces |
| **Reused · pre-event** | Lending controller baseline; Dynamic wallet integration | controller below; wallet lives in the private `seikine-app` |
| **NEW (Jun 12–14)** | Chainlink circuit breaker | `contracts/src/SeikineLendingController.sol` + `test/CircuitBreaker.t.sol` |
| **NEW (Jun 12–14)** | ENS wildcard position resolver | `contracts/src/SeikinePositionResolver.sol` + `test/PositionResolver.t.sol` |
| **NEW (Jun 12–14)** | ENS live-profile CCIP-Read gateway | `ens-gateway/` |
| **NEW (Jun 12–14)** | ENS registration + resolution demo | `ens-demo/` |
| **Roadmap** | Tokenized position-NFTs (ERC-1155 via v2 registry factory); ZK shielded positions (Groth16) | not built here, will be added later |

> **On the public controller:** `SeikineLendingController.sol` is a reference
> skeleton matching the deployed contract's external ABI. Its per-asset
> accounting is baseline placeholder — not Seikine's production logic — and it
> is not the bytecode running on Sepolia. The production controller and core
> are private.

## Layout

```
contracts/                     Foundry project (one build, one self-contained check)
  src/
    SeikineLendingController.sol   public baseline + circuit-breaker host
    SeikinePositionResolver.sol    wildcard CCIP-Read resolver (ENSIP-10 + EIP-3668)
    interfaces/                    ISeikineTreasury / ISeikineCollateralVault / ISeikineLens (signatures only)
    vendor/                        minimal vendored Chainlink + ENS interfaces (MIT)
    private/                       local-only impls for deploy (gitignored)
  test/                            CircuitBreaker + PositionResolver tests
  script/                          deploy scripts (gitignored — carry addresses)
ens-gateway/                   EIP-3668 service: reads ISeikineLens via RPC, signs responses
ens-demo/                      ens-cli registration scripts + a viem resolution surface
docs/                          architecture.md, demo-runbook.md
```

See [`docs/architecture.md`](docs/architecture.md) for how the pieces fit and
[`docs/demo-runbook.md`](docs/demo-runbook.md) for the end-to-end demo.

## Quickstart

```bash
cd contracts && forge build      # compiles with NO private impl present
```

That build succeeding is the design invariant: the controller and resolver
depend on the treasury/vaults/lens **only through interfaces**, so the public
set is self-contained.

## Leak-safety

- Private contract implementations live in `contracts/src/private/` and deploy
  scripts in `contracts/script/` — both **gitignored**.
- The private frontend (`seikine-app`) is a separate sibling folder, **not in
  this repo**.
- The ENS gateway's **signing key** lives only in `ens-gateway/.env`
  (gitignored). The chain holds only the matching **public** address.

## License

MIT — see [`LICENSE`](LICENSE).
