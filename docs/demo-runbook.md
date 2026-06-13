# Demo runbook

End-to-end: deploy the public contracts (with the local private impls), wire ENS,
run the gateway, and resolve a live `*.seikine.eth` position name.

> Private implementations (treasury, vaults, routers, lens) live in the
> gitignored `contracts/src/private/` and deploy scripts in `contracts/script/`.
> They are present locally for deployment but never tracked.

## 1. Build + test the contracts

```bash
cd contracts
forge build
forge install foundry-rs/forge-std   # first time, for the test suite
forge test
```

`forge build` must succeed with **only** the public sources + interface stubs —
that proves the controller and resolver depend on no private file directly.

## 2. Deploy

```bash
# from contracts/, using the gitignored deploy script + a funded Sepolia key
forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Record the deployed `SeikineLendingController`, `ISeikineLens` impl, and
`SeikinePositionResolver` addresses. The resolver takes the gateway URL and the
gateway's **public** signer address as constructor args.

## 3. Run the gateway

```bash
cd ens-gateway
npm install
# .env: RPC_URL, SIGNER_PRIVATE_KEY (secret), LENS_ADDRESS, RESOLVER_ADDRESS
npm run dev
```

## 4. Register + point ENS

```bash
cd ens-demo/scripts
export SEIKINE_ENS_OWNER=0x…
./01-register-seikine-eth.sh
export SEIKINE_RESOLVER_ADDRESS=0x…   # deployed resolver
./02-set-resolver.sh
```

## 5. Resolve a virtual position name

```bash
cd ens-demo
npm install
npm run resolve -- alice.seikine.eth
```

Expect the subject address plus live `seikine:health` / `seikine:collateralUSD`
/ `seikine:debtUSD` text records — fetched off-chain by the gateway and verified
on-chain by the resolver. Try `lend.alice.seikine.eth` to confirm wildcard depth.

## 6. Show the breaker

With a position open, let the Sepolia feed go stale (or don't refresh the mock
aggregator) and read a USD view — it reverts `PriceFeedStale()`. The frontend
falls back to its client-side projection. Refresh the feed and the live values
return.
