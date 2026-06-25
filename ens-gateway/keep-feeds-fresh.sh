#!/usr/bin/env bash
# Refreshes both Seikine mock feeds every 50 min so they never cross the 1h staleness window.
# Run this during the judging window (leave the terminal open / laptop awake).
RPC="https://eth-sepolia.g.alchemy.com/v2/Fx4R9uSwgTMqIGCXT3r45"
PK="0xe29598f4c2c3580924f5e35066fb07324a86f09e23166171b5c3d802119c4ed6"
USDC_FEED="0x5e7bb543fc6b0b3eadc5e3672555b23b133434b8"
ETH_FEED="0x2404c36126af5d225b66ffec30172a5abdc0247a"

while true; do
  echo "[$(date '+%H:%M:%S')] refreshing feeds..."
  cast send "$USDC_FEED" "updateAnswer(int256)" 100000000   --rpc-url "$RPC" --private-key "$PK" >/dev/null 2>&1 && echo "  USDC \$1.00 ok"
  cast send "$ETH_FEED"  "updateAnswer(int256)" 300000000000 --rpc-url "$RPC" --private-key "$PK" >/dev/null 2>&1 && echo "  ETH  \$3000 ok"
  echo "  next refresh in 50 min"
  sleep 3000   # 50 minutes
done
