// SPDX-License-Identifier: MIT
// Mirrors OpenZeppelin Contracts utils/introspection/IERC165.sol (MIT).
pragma solidity >=0.4.16;

/// @dev Interface of the ERC-165 standard, as defined in the
///      https://eips.ethereum.org/EIPS/eip-165[ERC]. `type(IERC165).interfaceId`
///      is `0x01ffc9a7`.
interface IERC165 {
    /// @dev Returns true if this contract implements the interface defined by
    ///      `interfaceId`.
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
