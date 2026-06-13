// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title ISeikineLens
/// @notice Read-only position view that the ENS gateway queries off-chain
///         (over RPC) to build the live profile for a `*.seikine.eth` name.
/// @dev    SIGNATURES ONLY. The concrete lens implementation lives in the
///         gitignored `contracts/src/private/` directory and is never part of
///         the public repo — the gateway consumes *this* interface's ABI, so
///         no private file ever needs to be published to read live state.
///
///         Shapes mirror exactly what the Seikine frontend reads today via
///         `useUserPosition`: USD figures are 1e18-scaled, the health factor
///         is in basis points (10000 = 1.00), and `type(uint256).max` is the
///         "infinite health / no debt" sentinel.
interface ISeikineLens {
    struct Position {
        uint256 collateralUSD; // 1e18-scaled total collateral value
        uint256 debtUSD; // 1e18-scaled total debt value
        uint256 maxBorrowUSD; // 1e18-scaled borrow capacity
        uint256 healthFactorBps; // 10000 = 1.00; type(uint256).max = no debt
        bool liquidatable; // true once healthFactorBps < 10000
    }

    /// @notice Aggregated lending position for `user`, in the units above.
    function getPosition(address user) external view returns (Position memory);
}
