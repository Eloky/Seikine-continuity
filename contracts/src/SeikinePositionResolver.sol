// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IExtendedResolver} from "ens/IExtendedResolver.sol";
import {IResolverService} from "ens/IResolverService.sol";
import {SignatureVerifier} from "ens/SignatureVerifier.sol";
import {IERC165} from "openzeppelin/IERC165.sol";

/// @title  SeikinePositionResolver
/// @notice One wildcard CCIP-Read (EIP-3668) resolver for every `*.seikine.eth`
///         name. Set once as the resolver of `seikine.eth`, it answers for
///         `alice.seikine.eth`, `lend.alice.seikine.eth`, etc. via ENSIP-10
///         longest-suffix matching — NOTHING is minted per name. A read reverts
///         `OffchainLookup`, the client re-queries the offchain gateway
///         (`ens-gateway/`), and `resolveWithProof` verifies the gateway's
///         signature before returning the live position record.
///
/// @dev    Canonical `ensdomains/offchain-resolver` (MIT), configured — not
///         reinvented. It holds NO Seikine accounting: `resolve` hands the whole
///         DNS-encoded `name` + `data` to the gateway and never parses the
///         subname on-chain, so this is public-native (no private mirror). The
///         resolver stores only the gateway's PUBLIC signer address(es); the
///         matching private signing key lives solely in the gateway's gitignored
///         `.env`. `url` and `signers` are owner-settable so the resolver can be
///         deployed before the gateway exists, then pointed at it with no
///         redeploy.
contract SeikinePositionResolver is IExtendedResolver, IERC165 {
    /// @notice Gateway endpoint (EIP-3668 URL). Owner-settable post-deploy.
    string public url;

    /// @notice Trusted gateway signer(s). The gateway signs CCIP-Read responses
    ///         with the private key whose address is registered here.
    mapping(address => bool) public signers;

    /// @notice Admin able to set `url` / `signers` (the deployer by default).
    address public owner;

    /// @notice EIP-3668: instructs a CCIP-Read client to call `urls` off-chain
    ///         and hand the answer back through `callbackFunction`.
    error OffchainLookup(
        address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData
    );

    error NotOwner();

    event UrlSet(string url);
    event SignerSet(address indexed signer, bool ok);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param url_    Gateway endpoint (use a placeholder until the gateway is
    ///                hosted, then `setUrl`).
    /// @param signer_ Initial trusted gateway signer (its PUBLIC address). May be
    ///                `address(0)` to register signers later via `setSigner`.
    constructor(string memory url_, address signer_) {
        owner = msg.sender;
        url = url_;
        if (signer_ != address(0)) {
            signers[signer_] = true;
            emit SignerSet(signer_, true);
        }
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    /// @notice Point the resolver at the gateway once it's hosted (no redeploy).
    function setUrl(string calldata url_) external onlyOwner {
        url = url_;
        emit UrlSet(url_);
    }

    /// @notice Add or remove a trusted gateway signer (key rotation).
    function setSigner(address signer, bool ok) external onlyOwner {
        signers[signer] = ok;
        emit SignerSet(signer, ok);
    }

    // ─── ENSIP-10 entrypoint ─────────────────────────────────────────────────

    /// @notice Wildcard resolution entrypoint. Reverts `OffchainLookup` to send
    ///         the full query to the gateway.
    /// @param name DNS-wire-encoded ENS name (e.g. `lend.alice.seikine.eth`).
    /// @param data ABI-encoded resolver call (`addr`, `text`, …) — passed through
    ///             untouched; record keys are interpreted by the gateway.
    function resolve(bytes calldata name, bytes calldata data)
        external
        view
        override
        returns (bytes memory)
    {
        bytes memory callData = abi.encodeCall(IResolverService.resolve, (name, data));
        string[] memory urls = new string[](1);
        urls[0] = url;
        revert OffchainLookup(
            address(this),
            urls,
            callData,
            this.resolveWithProof.selector,
            callData // extraData == the request; re-verified verbatim in the callback
        );
    }

    // ─── EIP-3668 callback ───────────────────────────────────────────────────

    /// @notice Verify the gateway's signature over its response and return the
    ///         resolver result. Reverts if the response is expired (in
    ///         `SignatureVerifier`) or not signed by a registered signer.
    /// @param response The gateway's `abi.encode(result, expires, sig)`.
    /// @param extraData The original request bytes echoed by the client (the
    ///                  `callData` from `resolve`), bound into the signature.
    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external
        view
        returns (bytes memory)
    {
        (address signer, bytes memory result) = SignatureVerifier.verify(extraData, response);
        require(signers[signer], "SeikinePositionResolver: invalid signer");
        return result;
    }

    // ─── ERC-165 ─────────────────────────────────────────────────────────────

    /// @dev `IExtendedResolver.interfaceId` (0x9061b923) is mandatory — the v2
    ///      UniversalResolver checks it to route wildcard/offchain resolution.
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IExtendedResolver).interfaceId // 0x9061b923 (ENSIP-10)
            || interfaceId == type(IERC165).interfaceId; // 0x01ffc9a7 (ERC-165)
    }
}
