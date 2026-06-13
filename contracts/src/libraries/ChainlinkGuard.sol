// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title ChainlinkGuard
/// @notice Stateless fail-closed price guard for Chainlink Data Feeds. A stale,
///         zero/negative, incomplete, or out-of-bounds answer makes the read
///         *revert* instead of letting the protocol price collateral/debt off
///         bad data. Inlines into the caller (no separate deployment); the
///         identical file is mirrored into the public skeleton so both repos
///         share the exact same guard bytes and errors.
/// @dev    `answeredInRound >= roundId` is deliberately omitted — Chainlink is
///         phasing `answeredInRound` out and it causes false reverts on newer
///         aggregators. `answer > 0` + bounds + `updatedAt != 0` + staleness are
///         the load-bearing checks.
library ChainlinkGuard {
    error BadPrice();          // answer <= 0
    error PriceOutOfBounds();  // answer outside [minAnswer, maxAnswer]
    error RoundNotComplete();  // updatedAt == 0
    error PriceFeedStale();    // block.timestamp - updatedAt > maxStaleness

    /// @return price     the feed answer as uint256 (still in the feed's own decimals)
    /// @return decimals  the feed's decimals(), so the caller can normalize
    function readSafe(
        AggregatorV3Interface feed,
        uint256 maxStaleness,
        int256 minAnswer,
        int256 maxAnswer
    ) internal view returns (uint256 price, uint8 decimals) {
        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (answer < minAnswer || answer > maxAnswer) revert PriceOutOfBounds();
        if (updatedAt == 0) revert RoundNotComplete();
        if (block.timestamp - updatedAt > maxStaleness) revert PriceFeedStale();
        return (uint256(answer), feed.decimals());
    }
}
