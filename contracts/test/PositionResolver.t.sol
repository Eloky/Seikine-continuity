// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Wildcard resolver tests — fleshed out during the hackathon (June 12–14).
//
// Target: SeikinePositionResolver. Cases to add:
//   • resolve(name, data) reverts OffchainLookup with the gateway url and the
//     resolveWithProof callback selector
//   • resolveWithProof accepts a response signed by `signer`
//   • resolveWithProof reverts InvalidSigner on a wrong-key signature
//   • resolveWithProof reverts SignatureExpired past `expires`
//   • supportsInterface is true for IExtendedResolver + ERC-165
//
// Uses forge-std (added with the first test commit) for vm.sign / signer keys.
// Kept dependency-free here so the scaffold builds offline.
contract PositionResolverTest {
    // placeholder — see docs/demo-runbook.md
}
