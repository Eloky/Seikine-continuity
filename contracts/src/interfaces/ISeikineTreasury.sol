// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title ISeikineTreasury
/// @notice Custody surface for borrowable liquidity. The controller pulls
///         debt assets out on `borrow` and returns them on `repay`; the
///         treasury holds the float and enforces controller-only access.
/// @dev    SIGNATURES ONLY. The concrete treasury (yield routing, reserves,
///         per-asset caps) stays in the gitignored `private/` directory.
interface ISeikineTreasury {
    /// @notice Available borrowable liquidity for `asset`.
    function liquidity(address asset) external view returns (uint256);

    // --- Controller-only custody movements ---------------------------------

    /// @notice Send `amount` of `asset` to `to` (a borrow disbursal).
    function disburse(address asset, address to, uint256 amount) external;

    /// @notice Pull up to `amount` of `asset` from `from` (a repayment).
    /// @return collected The amount actually transferred in.
    function collect(address asset, address from, uint256 amount)
        external
        returns (uint256 collected);
}
