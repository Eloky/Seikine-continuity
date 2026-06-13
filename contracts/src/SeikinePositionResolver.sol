// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IExtendedResolver} from "ens/IExtendedResolver.sol";

/// @title  SeikinePositionResolver
/// @notice One wildcard CCIP-Read resolver for every `*.seikine.eth` name.
///         Set once as the resolver of `seikine.eth`, it answers for
///         `alice.seikine.eth`, `lend.alice.seikine.eth`, etc. via ENSIP-10
///         longest-suffix matching — NOTHING is minted per name. Reads of a
///         name revert `OffchainLookup` (EIP-3668), the client re-queries the
///         offchain gateway (`ens-gateway/`), and `resolveWithProof` verifies
///         the gateway's signature before returning the live position profile.
///
/// @dev    SKELETON. The interface surface and the EIP-3668 round-trip shape
///         are final; the wildcard name parse (subject extraction under
///         seikine.eth) and the full request/response encoding are completed
///         during the event (separate spec). Only the gateway's PUBLIC
///         verification address (`signer`) is ever committed here — the
///         matching private signing key lives solely in the gateway's
///         gitignored `.env`.
contract SeikinePositionResolver is IExtendedResolver {
    /// @notice EIP-3668: instructs a CCIP-Read client to call `urls` off-chain
    ///         and hand the answer back through `callbackFunction`.
    error OffchainLookup(
        address sender,
        string[] urls,
        bytes callData,
        bytes4 callbackFunction,
        bytes extraData
    );

    error InvalidSigner();
    error SignatureExpired();
    error NotOwner();

    address public owner;
    /// @notice Gateway endpoint (EIP-3668 URL template).
    string public url;
    /// @notice PUBLIC address the gateway signs with. The private key is never
    ///         in this repo — it lives in `ens-gateway/.env` (gitignored).
    address public immutable signer;

    event UrlSet(string url);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(string memory url_, address signer_) {
        owner = msg.sender;
        url = url_;
        signer = signer_;
    }

    function setUrl(string calldata url_) external onlyOwner {
        url = url_;
        emit UrlSet(url_);
    }

    // ─── ENSIP-10 entrypoint ────────────────────────────────────────────────

    /// @notice Wildcard resolution entrypoint. Reverts `OffchainLookup` to send
    ///         the query to the gateway.
    /// @param name DNS-wire-encoded ENS name (e.g. `alice.seikine.eth`).
    /// @param data ABI-encoded resolver call (`addr`, `text`, …).
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        // During the event: parse `name` (longest-suffix under seikine.eth) to
        // the subject address and select the requested record before building
        // the gateway request. The EIP-3668 revert below is the final shape.
        bytes memory callData = abi.encodeWithSelector(
            ISeikineGateway.resolveProfile.selector,
            address(this),
            name,
            data
        );
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            abi.encode(name, data) // extraData: rebind the request in the callback
        );
    }

    // ─── EIP-3668 callback ──────────────────────────────────────────────────

    /// @notice Verifies the gateway's signature over its response and returns
    ///         the resolver result. Reverts if the signature is expired or not
    ///         from the registered `signer`.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (bytes memory result, uint64 expires, bytes memory sig) =
            abi.decode(response, (bytes, uint64, bytes));
        if (expires < block.timestamp) revert SignatureExpired();
        bytes32 hash = makeSignatureHash(address(this), expires, extraData, result);
        if (_recover(hash, sig) != signer) revert InvalidSigner();
        return result;
    }

    /// @notice Hash the gateway signs over — binds resolver, expiry, the exact
    ///         request, and the result (mirrors ENS `SignatureVerifier`).
    function makeSignatureHash(
        address target,
        uint64 expires,
        bytes memory request,
        bytes memory result
    ) public pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(hex"1900", target, expires, keccak256(request), keccak256(result))
        );
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IExtendedResolver).interfaceId // ENSIP-10
            || interfaceId == 0x01ffc9a7; // ERC-165
    }

    // ─── Internal ─────────────────────────────────────────────────────────

    /// @dev Recover the signer of a 65-byte ECDSA signature.
    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        return ecrecover(hash, v, r, s);
    }
}

/// @notice Off-chain gateway request shape consumed by `ens-gateway/`. The
///         gateway reads live state through `ISeikineLens` over RPC, signs the
///         response with the key in its `.env`, and returns `(result, expires,
///         sig)` ABI-encoded.
interface ISeikineGateway {
    function resolveProfile(address sender, bytes calldata name, bytes calldata data)
        external
        view
        returns (bytes memory result, uint64 expires, bytes memory sig);
}
