// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ChainlinkGuard} from "../src/libraries/ChainlinkGuard.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Exercises `ChainlinkGuard` against the LIVE Sepolia ETH/USD feed —
///         the prize-qualifying path, otherwise only covered by mocks. Forks at
///         latest (no pinned block) so freshness reflects the current chain
///         tip. Constants mirror the WETH `setFeedGuardParams` config from the
///         breaker spec / Part-1 verification (21600s, 100e8, 100_000e8).
/// @dev Uses the same `AggregatorV3Interface` the guard imports (breaker
///      deviation #2) and the repo's solc 0.8.24 pin. Requires SEPOLIA_RPC_URL
///      (forge auto-loads it from the repo `.env`).
contract CircuitBreakerForkRealFeed is Test {
    address constant ETH_USD       = 0x694AA1769357215DE4FAC081bf1f309aDC325306; // Sepolia ETH/USD
    uint64  constant MAX_STALENESS = 6 hours;        // matches setFeedGuardParams 21600
    int256  constant MIN_ANSWER    = 100e8;          // $100   (10000000000)
    int256  constant MAX_ANSWER    = 100_000e8;      // $100k  (10000000000000)

    function setUp() public {
        vm.createSelectFork(vm.envString("SEPOLIA_RPC_URL")); // match suite's fork pattern
    }

    /// DIAGNOSTIC — never asserts on freshness, just reports it. Run this for
    /// the number that tells you whether 6h is the right threshold for the live
    /// feed.
    function test_RealFeed_Freshness() public {
        ( , int256 answer, , uint256 updatedAt, ) =
            AggregatorV3Interface(ETH_USD).latestRoundData();
        uint8 dec = AggregatorV3Interface(ETH_USD).decimals();
        emit log_named_int   ("live answer (raw)", answer);
        emit log_named_uint  ("decimals", dec);
        emit log_named_uint  ("age seconds (block.timestamp - updatedAt)", block.timestamp - updatedAt);
    }

    /// The guard passes against the live feed with the deployed config.
    /// @dev Not `view`: it emits a `log_named_uint` to report the live price,
    ///      and emitting writes a log (disallowed in `view`).
    function test_RealFeed_GuardPasses() public {
        (uint256 price, uint8 dec) = ChainlinkGuard.readSafe(
            AggregatorV3Interface(ETH_USD), MAX_STALENESS, MIN_ANSWER, MAX_ANSWER
        );
        assertEq(dec, 8, "ETH/USD is 8 decimals");
        assertGt(price, uint256(MIN_ANSWER), "below sane floor");
        assertLt(price, uint256(MAX_ANSWER), "above sane ceiling");
        emit log_named_uint("live ETH/USD (8dp)", price);
    }
}
