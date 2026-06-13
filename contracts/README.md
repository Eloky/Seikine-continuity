# contracts

The **public** Foundry project for Seikine's hackathon work: the two new on-chain
pieces, plus just enough interface/skeleton to build and test them with **no private
implementation present**.

## What's here

| Path | What it is |
| ---- | ---------- |
| `src/SeikineLendingController.sol` | Public baseline controller + the Chainlink circuit-breaker host. |
| `src/libraries/ChainlinkGuard.sol` | Stateless, fail-closed Chainlink Data Feeds guard (the production guard, byte-for-byte). |
| `src/SeikinePositionResolver.sol` | Wildcard `*.seikine.eth` CCIP-Read resolver (ENSIP-10 + EIP-3668). |
| `src/interfaces/` | `ISeikineTreasury` / `ISeikineCollateralVault` / `ISeikineLens` — signatures only. |
| `src/vendor/` | Minimal vendored Chainlink / ENS / OpenZeppelin interfaces (MIT). |
| `test/` | `CircuitBreaker.t.sol`, `PositionResolver.t.sol`. |

> Like the deployed controller, `SeikineLendingController.sol` is a **reference
> skeleton**: it matches the production contract's external ABI, its per-asset
> accounting is baseline placeholder, and it is **not** the bytecode running on
> Sepolia. The production controller and core are private. That `forge build`
> succeeds with no private impl present is the design invariant — the public set
> depends on treasury / vaults / lens **only through interfaces**.

## Chainlink Data Feeds — the circuit breaker (prize submission)

`_readPrice` in `SeikineLendingController.sol` is the breaker seam: every
USD-denominated view prices through it, and it routes the read through
`ChainlinkGuard.readSafe`. A non-positive (`BadPrice`), out-of-bounds
(`PriceOutOfBounds`), incomplete-round (`RoundNotComplete`), or stale
(`PriceFeedStale()`, selector `0x216cc5f5`) answer **reverts** instead of pricing
collateral or debt off bad data — so the entire borrow / liquidation path fails
closed.

`test/CircuitBreaker.t.sol` proves it deterministically and **offline** (no fork, no
live feed): guard unit tests for every failure mode, plus borrow-path integration
tests where a state-changing `borrow` reverts on a zero / out-of-bounds / stale feed
and succeeds again once the feed is healthy.

## Build & test

```bash
forge build      # compiles against public sources + interface stubs only
forge test       # runs the offline CircuitBreaker + PositionResolver suites
```

Deployed on Sepolia: controller `0xaAb9801E5f3a0789BC272f24250b16Cc1975527A`,
resolver `0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0`.
