# seikine-ens-gateway

EIP-3668 **CCIP-Read** gateway for the `*.seikine.eth` wildcard resolver. It reads
live Seikine positions over RPC from `SeikineLendingController`, signs them with
the gateway key, and returns the signed response that
[`SeikinePositionResolver`](../contracts/src/SeikinePositionResolver.sol) verifies
on-chain.

```
ENS client ──resolve(borrow.alice.seikine.eth)──▶ SeikinePositionResolver
     ▲                                               │ reverts OffchainLookup(url, callData, …)
     │ verified value                                ▼
     └──── resolveWithProof(response) ◀── this gateway ──readContract──▶ SeikineLendingController (RPC)
```

The resolver checks every response against its registered **public** signer
address. The gateway holds the matching **private** key — the one secret in the
system — and it never leaves `.env` / the host's secret env.

## The fixed contract (resolver ⇄ gateway)

The resolver defers to `IResolverService.resolve` (matching
[`contracts/src/vendor/ens/IResolverService.sol`](../contracts/src/vendor/ens/IResolverService.sol)):

```solidity
function resolve(bytes calldata name, bytes calldata data)
    external view returns (bytes memory result, uint64 expires, bytes memory sig);
```

**The gateway signs exactly this digest — byte-for-byte (this is the #1 thing to get right):**

```
digest = keccak256(abi.encodePacked(
    hex"1900",
    RESOLVER_ADDRESS,        // 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0
    expires,                 // uint64 unix seconds, >= block.timestamp at verify
    keccak256(callData),     // the RAW request bytes the client POSTed (the encoded resolve(name,data))
    keccak256(result)        // the ABI-encoded record — for text(): abi.encode(string)
))
```

- Signed as a **raw digest** with the gateway key — not `personal_sign`; the
  `0x1900` (EIP-191 v0x00, "intended validator") is the whole envelope.
- `sig` = 65 bytes `r‖s‖v`, `v ∈ {27,28}`, canonical low-`s`.
- **HTTP response body** = `abi.encode(['bytes','uint64','bytes'], [result, expires, sig])`,
  returned as JSON `{ "data": "0x…" }`.

See [`src/handler.js`](src/handler.js) (`makeDigest` / `handleRequest`). The signer
address `0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21` is registered in the resolver's
`signers` map, so its signatures verify. Sanity check:
`cast call 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 "signers(address)(bool)" 0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21` → `true`.

## Environment (`.env` — gitignored, never commit the key)

Copy [`.env.example`](.env.example) to `.env` and fill:

| Var                  | Description                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `GATEWAY_SIGNER_PK`  | **Secret.** Signs CCIP-Read responses. Public addr → resolver.      |
| `RPC_URL`            | Sepolia RPC the gateway reads positions through.                    |
| `RESOLVER_ADDRESS`   | Deployed `SeikinePositionResolver` (bound into the signature hash). |
| `CONTROLLER_ADDRESS` | Deployed `SeikineLendingController` (the live position source).     |
| `PORT`               | HTTP port (default `8080`).                                         |
| `DATA_DIR`           | _Optional._ Dir for the live-registration store (default `./data`; set to a mounted volume for persistence). |

## Run

```bash
npm install
cp .env.example .env   # then fill in the real values
npm start              # POST /  { sender, data }  → { data: "0x…" }
npm test               # offline unit + round-trip suite (no RPC needed)
```

## Name grammar — `lend` = supply view, `borrow` = risk view

Each subname is a distinct profile; keys outside an action's set return `""`.

| name                         | keys answered                                                        | reads |
| ---------------------------- | -------------------------------------------------------------------- | ----- |
| `lend.<user>.seikine.eth`    | `seikine:collateralUSD`, `seikine:collateralAssets`                  | `userTotalCollateralUSD`, `userCollateralVaults` |
| `borrow.<user>.seikine.eth`  | `seikine:debtUSD`, `seikine:debtToken`, `seikine:healthFactor`, `seikine:ltv` | `userTotalDebtUSD`, `userDebtAssets`, `userHealthFactorBps` |
| `<user>.seikine.eth`         | all of the above                                                     | all |

Health factor and LTV live on **borrow** (properties of the debt); LTV is derived
`debtUSD / collateralUSD` (no getter). Formatting: USD `formatUnits(raw,18)` → `"$90.59"`;
health `raw/1e4` → `"11.19x"` (or `"No active debt"` at `type(uint256).max`); LTV → `"7.15%"`.
`debtToken` / `collateralAssets` resolve each address to its `symbol()` (e.g. `"USDC"`),
cached, with the address as a graceful fallback.

### Graceful degradation (the breaker, visible through ENS)

The controller's price-touching reads revert `PriceFeedStale()` (selector
`0x216cc5f5`) whenever a Chainlink feed lags past its staleness limit — which on a
testnet feed *will* happen. The gateway catches that and returns
`"unavailable (price feed stale)"` for that key, so **the name still resolves with
a valid signed response** — the safety breaker shows up in the ENS record instead
of breaking the demo. (`src/controller.js` `safeRead`.) Refresh the feed before
demoing to widen the margin.

## How it's wired (and how to verify it)

The gateway is **deployed and live** at
`https://seikine-continuity-production.up.railway.app`. The `SeikinePositionResolver`
on `seikine.eth` already points at it, and the name is wired to the resolver — there
is nothing to stand up. Here's the wiring and how to check each link yourself. Any
Sepolia RPC works for `--rpc-url`; the public `https://rpc.sepolia.org` is fine.

1. **The resolver points at the hosted gateway.** Its `url` was set (`setUrl`) to the
   Railway URL, so the resolver's `OffchainLookup` sends clients there:
   ```bash
   cast call 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 "url()(string)" --rpc-url https://rpc.sepolia.org
   # → https://seikine-continuity-production.up.railway.app/
   ```
2. **The name is wired to the resolver.** `seikine.eth` was set to this resolver on
   the ENS v2 registry `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67` via
   `setResolver(tokenId, resolver)`, token ID
   `73813321819503697881936177697534762413441876033113719862144698342846247206912`.
3. **The gateway's signer is registered.** The resolver verifies every response
   against this public address:
   ```bash
   cast call 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 "signers(address)(bool)" 0x5b9dC9e5F402b2c79A9570457Bbea2d3D8832A21 --rpc-url https://rpc.sepolia.org
   # → true
   ```
4. **Resolve a name end-to-end — the whole chain proving out.** `resolve-test.mjs`
   calls the resolver directly and follows the EIP-3668 `OffchainLookup` to the hosted
   gateway via viem, verifying the signed response (reads `RPC_URL` from `.env`, no
   secrets):
   ```bash
   # in ens-gateway/
   node --env-file=.env resolve-test.mjs
   # → borrow.alice debtUSD       = $6.48
   # → lend.alice   collateralUSD = $90.59
   ```
   resolver `OffchainLookup` → hosted gateway → live controller read → signed response
   → resolver verifies → value. Nothing is minted per name (virtual subnames via
   ENSIP-10 wildcard). The `ens` CLI can also resolve these names if pointed at the v2
   registry, but this viem script is the verified, dependency-free path.

If a USD field comes back `unavailable (price feed stale)`, the safety breaker tripped
on a lagging testnet feed (see **Graceful degradation** above) — refresh the feed and
re-run; the name still resolves either way.

### Run your own instance

You don't need to — the deployment above is live — but to redeploy from scratch:

1. **Host** the Express app on a public HTTPS URL with a Node runtime — Railway or
   Render (free tier) deploy straight from `ens-gateway/`. Set `GATEWAY_SIGNER_PK`,
   `RPC_URL`, `RESOLVER_ADDRESS`, `CONTROLLER_ADDRESS` as the host's **secret** env
   vars — **the signer key as a secret, never in the repo.**
2. **Point the resolver at your host** (the resolver owner can reset `url`; no
   redeploy):
   ```bash
   cast send 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 "setUrl(string)" "https://your-host.example/" --rpc-url https://rpc.sepolia.org --private-key $PK
   ```
3. **Wire the name to the resolver** (v2 `setResolver` by token ID):
   ```bash
   cast send 0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67 "setResolver(uint256,address)" 73813321819503697881936177697534762413441876033113719862144698342846247206912 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 --rpc-url https://rpc.sepolia.org --private-key $PK
   ```
4. Re-run the verification above against your URL.

## Live registration (tier-2)

Anyone can claim a name live — open the gateway URL for the self-served form
(`GET /`), enter a `name` + `address`, and `borrow.<name>.seikine.eth` immediately
resolves that wallet's position through the unchanged signing path. Nothing is
minted on-chain.

```bash
curl -X POST https://seikine-continuity-production.up.railway.app/register \
  -H "Content-Type: application/json" -d '{"name":"bob","address":"0x…"}'
# → { ok: true, names: ["bob.seikine.eth", "lend.bob.seikine.eth", "borrow.bob.seikine.eth"] }
```

- **Store** ([`src/names.js`](src/names.js)): seed-then-registrations, so `alice`
  (the demo position) can't be hijacked; `lend`/`borrow`/`seikine`/`eth` are reserved;
  first-come-first-served; checksummed addresses; write-through to `DATA_DIR/names.json`.
- **Persistence across redeploys:** mount a volume and set `DATA_DIR=/data`. Without
  it, registrations live until the next restart — fine for a contained booth session.
- The label→address lookup is the only change; the CCIP signing/resolve path is identical.
