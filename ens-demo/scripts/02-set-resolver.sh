#!/usr/bin/env bash
# Point seikine.eth at the wildcard CCIP-Read resolver. After this one call,
# EVERY *.seikine.eth name resolves through SeikinePositionResolver via ENSIP-10
# longest-suffix matching — nothing is minted per name.
#
# Run by Elian; ens-cli builds the calldata and HIS wallet signs. The resolver
# address is PUBLIC (it's a deployed contract), so it's safe to pass/commit.
set -euo pipefail

CHAIN="sepolia"
NAME="seikine.eth"
# Deployed SeikinePositionResolver address (public). Fill in after deploy.
RESOLVER="${SEIKINE_RESOLVER_ADDRESS:-0xYOUR_DEPLOYED_RESOLVER_ADDRESS}"

if [[ "${RESOLVER}" == 0xYOUR_* ]]; then
  echo "Set SEIKINE_RESOLVER_ADDRESS (or edit this script) to the deployed resolver first." >&2
  exit 1
fi

echo "Setting resolver of ${NAME} → ${RESOLVER} on ${CHAIN}…"

ens resolver set "${NAME}" \
  --resolver "${RESOLVER}" \
  --chain "${CHAIN}"

echo "Done. Verify with:  npm --prefix .. run resolve -- alice.seikine.eth"
