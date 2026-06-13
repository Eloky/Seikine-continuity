// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SignatureVerifier
/// @notice CCIP-Read response verifier, adapted from
///         `ensdomains/offchain-resolver` (MIT). The signing scheme
///         (`makeSignatureHash`) and the `verify` flow are kept verbatim with
///         the ENS original, so any gateway built for the canonical
///         OffchainResolver signs responses this verifier accepts.
/// @dev    The only deviation from the upstream file is that `ECDSA.recover`
///         (OpenZeppelin) is inlined as a minimal, self-contained recover with
///         the same security properties — 65-byte signatures only, EIP-2 low-`s`
///         malleability rejection, and `v in {27, 28}`. This keeps the vendored
///         ENS surface to a single tiny file with no external dependency, in
///         line with how the repo vendors `AggregatorV3Interface`.
library SignatureVerifier {
    /// @notice The digest the gateway signs: an EIP-191 version `0x00`
    ///         ("intended validator") hash binding the resolver address, the
    ///         response expiry, the exact request (the ABI-encoded
    ///         `IResolverService.resolve` call), and the result.
    function makeSignatureHash(address target, uint64 expires, bytes memory request, bytes memory result)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result)));
    }

    /// @notice Decode a gateway response `(result, expires, sig)`, recover the
    ///         signer over `makeSignatureHash`, and enforce the expiry. Returns
    ///         the recovered signer and the result; the caller checks the signer
    ///         against its trusted set. `address(this)` is the calling resolver
    ///         (this is an `internal` library fn, inlined into the caller).
    function verify(bytes calldata request, bytes calldata response)
        internal
        view
        returns (address, bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) = abi.decode(response, (bytes, uint64, bytes));
        address signer = _recover(makeSignatureHash(address(this), expires, request, result), sig);
        require(expires >= block.timestamp, "SignatureVerifier: Signature expired");
        return (signer, result);
    }

    /// @dev Minimal OZ-`ECDSA.recover`-equivalent: rejects non-65-byte sigs,
    ///      upper-range `s` (malleability), and `v` outside {27, 28}.
    function _recover(bytes32 hash, bytes memory sig) private pure returns (address) {
        require(sig.length == 65, "SignatureVerifier: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert("SignatureVerifier: invalid signature 's' value");
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "SignatureVerifier: invalid signature 'v' value");
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "SignatureVerifier: invalid signature");
        return signer;
    }
}
