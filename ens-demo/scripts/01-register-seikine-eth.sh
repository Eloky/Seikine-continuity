#!/usr/bin/env bash
# Register seikine.eth (one-time). Run by Elian; ens-cli builds the calldata and
# HIS wallet signs — no private key is read from this repo.
#
# Prereqs: ens-cli installed and configured with Elian's Sepolia signer, and a
# funded Sepolia account. Adjust the owner/duration to taste.
set -euo pipefail

CHAIN="sepolia"
NAME="seikine.eth"
# Public owner address (Elian's). Safe to commit — it's an on-chain identity.
OWNER="${SEIKINE_ENS_OWNER:-0xYOUR_PUBLIC_OWNER_ADDRESS}"
DURATION="${SEIKINE_ENS_DURATION:-31536000}" # 1 year, seconds

echo "Registering ${NAME} on ${CHAIN} to ${OWNER} for ${DURATION}s…"

# Commit/reveal registration via the ENS v2 registrar. ens-cli prompts Elian to
# sign each tx in his wallet.
ens register "${NAME}" \
  --owner "${OWNER}" \
  --duration "${DURATION}" \
  --chain "${CHAIN}"

echo "Done. Next: ./02-set-resolver.sh after the resolver is deployed."
