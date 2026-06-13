// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title AggregatorV3Interface
/// @notice Chainlink Data Feeds read interface, vendored verbatim from the
///         Chainlink contracts package (chainlink/contracts on npm, MIT).
///         Only the surface the Seikine controller and the hackathon circuit
///         breaker consume is kept.
/// @dev    `updatedAt` is the staleness signal the breaker guards on;
///         `answer` is the price the breaker sanity-bounds.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
