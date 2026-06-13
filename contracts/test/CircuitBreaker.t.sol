// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Circuit-breaker tests — fleshed out during the hackathon (June 12–14).
//
// Target: SeikineLendingController._readPrice (the breaker seam). Cases to add:
//   • fresh feed within maxFeedStaleness  → USD views return a value
//   • answer older than maxFeedStaleness  → reverts PriceFeedStale()
//   • non-positive answer (<= 0)          → reverts PriceFeedStale()
//   • price outside configured bounds     → reverts PriceFeedStale()
//   • paused() blocks borrow/repay/lock/unlock
//
// The first test commit adds forge-std (`forge install foundry-rs/forge-std`),
// then `import {Test} from "forge-std/Test.sol";` plus a MockV3Aggregator to
// drive feed staleness. Kept dependency-free here so the scaffold builds offline.
contract CircuitBreakerTest {
    // placeholder — see docs/demo-runbook.md
}
