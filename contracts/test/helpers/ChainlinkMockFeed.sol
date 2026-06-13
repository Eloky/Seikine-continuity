// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ChainlinkMockFeed
/// @notice Minimal mock for an `AggregatorV3Interface` price feed in vault /
///         controller tests. Owner-less by design: tests own this contract
///         and may mutate `answer` / `updatedAt` arbitrarily through the
///         setters below to drive depeg / staleness scenarios.
/// @dev    The real `MockPriceFeed` under `src/mocks/` is owner-gated (it's
///         deployed to Sepolia under the spec deployer). Tests need a more
///         permissive variant — this helper is that variant.
contract ChainlinkMockFeed {
    int256  public answer;
    uint256 public updatedAt;
    uint8   public immutable decimals;
    string  public constant description = "Seikine test feed (mock)";
    uint256 public constant version = 1;

    constructor(uint8 decimals_, int256 initialAnswer) {
        decimals = decimals_;
        answer = initialAnswer;
        updatedAt = block.timestamp;
    }

    /// @notice Mirrors the AggregatorV3Interface signature exactly. Returns
    ///         `(roundId, answer, startedAt, updatedAt, answeredInRound)` —
    ///         only `answer` and `updatedAt` are meaningful for the
    ///         controller's reads; the others are stubbed to non-zero for
    ///         shape parity.
    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (uint80(1), answer, updatedAt, updatedAt, uint80(1));
    }

    /// @notice Update the published answer and reset `updatedAt` to now.
    function setAnswer(int256 newAnswer) external {
        answer = newAnswer;
        updatedAt = block.timestamp;
    }

    /// @notice Backdate `updatedAt` by `secondsOld` to drive staleness tests.
    function setStale(uint256 secondsOld) external {
        updatedAt = block.timestamp - secondsOld;
    }

    /// @notice Set `updatedAt` directly (independent of `answer`). Pass 0 to
    ///         simulate an incomplete round (RoundNotComplete).
    function setUpdatedAt(uint256 newUpdatedAt) external {
        updatedAt = newUpdatedAt;
    }
}
