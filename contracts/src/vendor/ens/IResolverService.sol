// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IResolverService
/// @notice The resolver<->gateway contract, from `ensdomains/offchain-resolver`
///         (MIT). The off-chain CCIP-Read gateway implements this; the on-chain
///         resolver ABI-encodes a call to `resolve(name, data)` as the EIP-3668
///         `callData` it asks the client to fetch.
/// @dev    SHARED INTERFACE — `ens-gateway/` (spec 2) MUST implement this exact
///         signature, and sign over the exact `callData` bytes the resolver
///         produces (see `SignatureVerifier`). Changing the selector or the
///         tuple here breaks signature verification on-chain.
interface IResolverService {
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, uint64 expires, bytes memory sig);
}
