// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title ISeikineCollateralVault
/// @notice The slice of a Seikine ERC-4626 collateral vault (e.g.
///         `SaWETH_Aave_Vault`, `SaWETH_Lido_Vault`) that the lending
///         controller depends on.
/// @dev    SIGNATURES ONLY — the concrete vault (router wiring, inflation-
///         attack offset, redeem path) stays in the gitignored `private/`
///         directory. The controller references this interface so the public
///         contract set compiles with no vault implementation present.
interface ISeikineCollateralVault {
    /// @notice Underlying asset held by the vault (the ERC-4626 `asset`).
    function asset() external view returns (address);

    function decimals() external view returns (uint8);

    /// @notice Total vault shares held by `account` (locked + unlocked).
    function balanceOf(address account) external view returns (uint256);

    /// @notice Underlying-asset value of `shares` (ERC-4626 conversion).
    function convertToAssets(uint256 shares) external view returns (uint256);

    /// @notice Shares currently locked as collateral for `user`. Unlocked
    ///         balance = balanceOf - lockedShares.
    function lockedShares(address user) external view returns (uint256);

    // --- Controller-only collateral movement -------------------------------
    // The vault restricts these to the configured controller. Declared here so
    // the controller can call them; the access check lives in the private impl.

    function lockShares(address user, uint256 shares) external;

    function unlockShares(address user, uint256 shares) external;
}
