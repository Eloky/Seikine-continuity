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
address `0xc04F4c30Cae99354BD2B6F5C099D73b94726c7b7` is registered in the resolver's
`signers` map, so its signatures verify. Sanity check:
`cast call 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 "signers(address)(bool)" 0xc04F4c30Cae99354BD2B6F5C099D73b94726c7b7` → `true`.

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

## Host + wire + verify (Elian)

1. **Host** the Express app on a public HTTPS URL with a Node runtime — Railway or
   Render (free tier) deploy straight from `ens-gateway/`. Set `GATEWAY_SIGNER_PK`,
   `RPC_URL`, `RESOLVER_ADDRESS`, `CONTROLLER_ADDRESS` as the host's secret env vars
   — **the signer key as a secret, never in the repo.**
2. **Point the resolver at it** (you're the owner; no redeploy — `url` is settable):
   ```bash
   cast send 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 "setUrl(string)" "https://<your-gateway-host>/" --rpc-url <sepolia> --private-key $PK
   ```
3. **Wire the name to the resolver** (v2 `setResolver` by token ID):
   ```bash
   cast send 0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67 "setResolver(uint256,address)" 73813321819503697881936177697534762413441876033113719862144698342846247206912 0x71d7882A2d38Df2d5F10d01f703CFB81EDC73EB0 --rpc-url <sepolia> --private-key $PK
   ```
4. **The live resolve — the whole chain proving out:**
   ```bash
   ens get text borrow.alice.seikine.eth --key seikine:debtUSD       # → "$6.48"
   ens get text lend.alice.seikine.eth   --key seikine:collateralUSD # → "$90.59"
   ```
   UniversalResolver → resolver `OffchainLookup` → this gateway → live controller
   read → signed response → resolver verifies → value. Nothing is minted per name
   (virtual subnames via ENSIP-10 wildcard).

## Live registration (tier-2)

Anyone can claim a name live — open the gateway URL for the self-served form
(`GET /`), enter a `name` + `address`, and `borrow.<name>.seikine.eth` immediately
resolves that wallet's position through the unchanged signing path. Nothing is
minted on-chain.

```bash
curl -X POST https://<gateway-host>/register \
  -H "Content-Type: application/json" -d '{"name":"bob","address":"0x…"}'
# → { ok: true, names: ["bob.seikine.eth", "lend.bob.seikine.eth", "borrow.bob.seikine.eth"] }
```

- **Store** ([`src/names.js`](src/names.js)): seed-then-registrations, so `alice`
  (the demo position) can't be hijacked; `lend`/`borrow`/`seikine`/`eth` are reserved;
  first-come-first-served; checksummed addresses; write-through to `DATA_DIR/names.json`.
- **Persistence across redeploys:** mount a volume and set `DATA_DIR=/data`. Without
  it, registrations live until the next restart — fine for a contained booth session.
- The label→address lookup is the only change; the CCIP signing/resolve path is identical.
