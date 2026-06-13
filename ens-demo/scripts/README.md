# ens-demo / scripts

ens-cli command sequences that register `seikine.eth` and point it at the
wildcard resolver. **They reference public addresses and the public resolver
only** — no private keys. ens-cli builds calldata and Elian's wallet signs.

| Step | Script                         | What it does                                                              |
| ---- | ------------------------------ | ------------------------------------------------------------------------- |
| 1    | `01-register-seikine-eth.sh`   | Register `seikine.eth` to a public owner via the ENS v2 registrar.        |
| 2    | `02-set-resolver.sh`           | Set `seikine.eth`'s resolver to the deployed `SeikinePositionResolver`.   |

After step 2, `alice.seikine.eth`, `lend.alice.seikine.eth`,
`borrow.alice.seikine.eth`, … all resolve through the one resolver (ENSIP-10),
with **nothing minted per name**.

```bash
export SEIKINE_ENS_OWNER=0x…           # public owner address
./01-register-seikine-eth.sh

export SEIKINE_RESOLVER_ADDRESS=0x…    # deployed resolver (public)
./02-set-resolver.sh
```

Resolve to confirm: `npm run resolve -- alice.seikine.eth` (from `ens-demo/`).
