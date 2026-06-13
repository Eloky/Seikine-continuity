// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title IExtendedResolver (ENSIP-10)
/// @notice Wildcard resolution interface, vendored from
///         `ensdomains/ens-contracts` (MIT). A resolver that implements this
///         is consulted via longest-suffix match, so a single contract set on
///         `seikine.eth` answers for every `*.seikine.eth` name without any
///         per-name record being written.
/// @dev    `name` is the DNS-wire-encoded ENS name; `data` is an ABI-encoded
///         resolver call (e.g. `addr(bytes32)`, `text(bytes32,string)`).
interface IExtendedResolver {
    function resolve(bytes memory name, bytes memory data)
        external
        view
        returns (bytes memory);
}
