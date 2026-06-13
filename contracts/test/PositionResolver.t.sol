// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// =============================================================================
// PositionResolver.t.sol — wildcard CCIP-Read resolver tests, fully OFFLINE.
//
// The resolver is unit-testable with no live gateway: we construct signed
// responses with a known test key (vm.sign) whose address is registered via
// the resolver's `signers` set, and assert the EIP-3668 round-trip:
//
//   1. resolve() reverts OffchainLookup — gateway url, resolveWithProof
//      callback, and callData that decodes back to (name, data).
//   2. resolveWithProof accepts a correctly-signed, unexpired response.
//   3. resolveWithProof rejects a response signed by an unregistered key.
//   4. resolveWithProof rejects an expired response.
//   5. supportsInterface is true for IExtendedResolver (0x9061b923) + ERC-165.
//
// Run: forge test --match-contract PositionResolverTest -vv
// =============================================================================

import {Test} from "forge-std/Test.sol";
import {SeikinePositionResolver} from "../src/SeikinePositionResolver.sol";
import {IExtendedResolver} from "ens/IExtendedResolver.sol";
import {IResolverService} from "ens/IResolverService.sol";
import {SignatureVerifier} from "ens/SignatureVerifier.sol";
import {IERC165} from "openzeppelin/IERC165.sol";

contract PositionResolverTest is Test {
    SeikinePositionResolver internal resolver;

    uint256 internal constant SIGNER_PK = 0xA11CE; // registered gateway signer
    uint256 internal constant WRONG_PK = 0xB0B; // never registered
    address internal signerAddr;

    string internal constant URL = "https://gateway.seikine.eth/lookup/{sender}/{data}.json";

    // DNS-wire encoding of `lend.alice.seikine.eth`. The resolver treats this as
    // opaque (passes it through to the gateway), so the exact value only matters
    // for byte-stability of the round-trip.
    bytes internal name = hex"046c656e6405616c696365077365696b696e650365746800";
    // text(namehash, "seikine:healthFactor"); selector 0x59d1d43c. node is a
    // placeholder — the gateway, not the resolver, interprets it.
    bytes internal data =
        abi.encodeWithSelector(0x59d1d43c, bytes32(uint256(0xBEEF)), "seikine:healthFactor");

    function setUp() public {
        vm.warp(10_000); // move off timestamp 0 so "expired" can be in the past
        signerAddr = vm.addr(SIGNER_PK);
        resolver = new SeikinePositionResolver(URL, signerAddr);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// @dev The exact request bytes the resolver builds and signs over.
    function _request() internal view returns (bytes memory) {
        return abi.encodeWithSelector(IResolverService.resolve.selector, name, data);
    }

    /// @dev Sign `(request, result, expires)` with `pk` under the resolver's
    ///      scheme: keccak256(0x1900 ‖ resolver ‖ expires ‖ keccak(req) ‖ keccak(res)).
    function _sign(uint256 pk, uint64 expires, bytes memory request, bytes memory result)
        internal
        view
        returns (bytes memory sig)
    {
        bytes32 digest = SignatureVerifier.makeSignatureHash(address(resolver), expires, request, result);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _stripSelector(bytes memory b) internal pure returns (bytes memory out) {
        require(b.length >= 4, "too short");
        out = new bytes(b.length - 4);
        for (uint256 i = 0; i < out.length; ++i) {
            out[i] = b[i + 4];
        }
    }

    // ── 1. resolve() reverts OffchainLookup ──────────────────────────────────

    function test_Resolve_RevertsOffchainLookup() public {
        try resolver.resolve(name, data) returns (bytes memory) {
            fail();
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), SeikinePositionResolver.OffchainLookup.selector, "OffchainLookup selector");

            (
                address sender,
                string[] memory urls,
                bytes memory callData,
                bytes4 callback,
                bytes memory extraData
            ) = abi.decode(_stripSelector(reason), (address, string[], bytes, bytes4, bytes));

            assertEq(sender, address(resolver), "sender == resolver");
            assertEq(urls.length, 1, "one gateway url");
            assertEq(urls[0], URL, "url matches");
            assertEq(callback, resolver.resolveWithProof.selector, "callback == resolveWithProof");
            assertEq(keccak256(extraData), keccak256(callData), "extraData == request");

            // callData is the ABI-encoded IResolverService.resolve(name, data).
            assertEq(bytes4(callData), IResolverService.resolve.selector, "callData selector");
            (bytes memory gotName, bytes memory gotData) =
                abi.decode(_stripSelector(callData), (bytes, bytes));
            assertEq(gotName, name, "callData decodes to name");
            assertEq(gotData, data, "callData decodes to data");
        }
    }

    // ── 2. resolveWithProof accepts a correctly-signed response ──────────────

    function test_ResolveWithProof_AcceptsValidSignature() public view {
        bytes memory request = _request();
        bytes memory result = abi.encode(string("2.10")); // e.g. a health-factor record
        uint64 expires = uint64(block.timestamp + 1 hours);

        bytes memory sig = _sign(SIGNER_PK, expires, request, result);
        bytes memory response = abi.encode(result, expires, sig);

        bytes memory got = resolver.resolveWithProof(response, request);
        assertEq(got, result, "returns the gateway result");
    }

    // ── 3. rejects an unregistered signer ────────────────────────────────────

    function test_ResolveWithProof_RejectsWrongSigner() public {
        bytes memory request = _request();
        bytes memory result = abi.encode(string("2.10"));
        uint64 expires = uint64(block.timestamp + 1 hours);

        bytes memory sig = _sign(WRONG_PK, expires, request, result); // valid sig, wrong key
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert(bytes("SeikinePositionResolver: invalid signer"));
        resolver.resolveWithProof(response, request);
    }

    // ── 4. rejects an expired response ───────────────────────────────────────

    function test_ResolveWithProof_RejectsExpired() public {
        bytes memory request = _request();
        bytes memory result = abi.encode(string("2.10"));
        uint64 expires = uint64(block.timestamp - 1); // already expired

        // Signed by the REGISTERED signer, so only the expiry check can fail.
        bytes memory sig = _sign(SIGNER_PK, expires, request, result);
        bytes memory response = abi.encode(result, expires, sig);

        vm.expectRevert(bytes("SignatureVerifier: Signature expired"));
        resolver.resolveWithProof(response, request);
    }

    // ── 5. supportsInterface ─────────────────────────────────────────────────

    function test_SupportsInterface() public view {
        assertTrue(resolver.supportsInterface(type(IExtendedResolver).interfaceId), "IExtendedResolver");
        assertEq(type(IExtendedResolver).interfaceId, bytes4(0x9061b923), "ENSIP-10 id");
        assertTrue(resolver.supportsInterface(type(IERC165).interfaceId), "ERC-165");
        assertEq(type(IERC165).interfaceId, bytes4(0x01ffc9a7), "ERC-165 id");
        assertFalse(resolver.supportsInterface(0xffffffff), "ignores unknown id");
        assertFalse(resolver.supportsInterface(0xdeadbeef), "ignores random id");
    }

    // ── bonus: owner-settable url + signers (deploy-before-gateway) ───────────

    function test_Admin_SetUrlAndSigner() public {
        resolver.setUrl("https://new.gateway/{sender}/{data}.json");
        assertEq(resolver.url(), "https://new.gateway/{sender}/{data}.json");

        address other = vm.addr(0xCAFE);
        assertFalse(resolver.signers(other));
        resolver.setSigner(other, true);
        assertTrue(resolver.signers(other));
        resolver.setSigner(other, false);
        assertFalse(resolver.signers(other));
    }

    function test_Admin_OnlyOwner() public {
        vm.prank(address(0xdead));
        vm.expectRevert(SeikinePositionResolver.NotOwner.selector);
        resolver.setUrl("https://evil.gateway");
    }
}
