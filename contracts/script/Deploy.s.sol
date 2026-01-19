// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DrainChannel} from "../src/DrainChannel.sol";

contract DeployScript is Script {
    // USDC addresses
    address constant USDC_POLYGON_MAINNET = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    address constant USDC_POLYGON_AMOY = 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582; // Test USDC

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envOr("USDC_ADDRESS", USDC_POLYGON_MAINNET);
        
        vm.startBroadcast(deployerPrivateKey);
        
        DrainChannel drain = new DrainChannel(usdcAddress);
        
        console.log("=== DRAIN Deployment ===");
        console.log("DrainChannel:", address(drain));
        console.log("USDC:", usdcAddress);
        console.log("Owner:", drain.owner());
        console.log("Chain ID:", block.chainid);
        console.log("");
        console.log("Next steps:");
        console.log("1. Test thoroughly");
        console.log("2. Call renounceOwnership() to make immutable");
        
        vm.stopBroadcast();
    }
}

contract RenounceScript is Script {
    function run() public {
        uint256 ownerPrivateKey = vm.envUint("PRIVATE_KEY");
        address drainAddress = vm.envAddress("DRAIN_ADDRESS");
        
        vm.startBroadcast(ownerPrivateKey);
        
        DrainChannel drain = DrainChannel(drainAddress);
        
        console.log("=== Renouncing Ownership ===");
        console.log("DrainChannel:", drainAddress);
        console.log("Current owner:", drain.owner());
        
        drain.renounceOwnership();
        
        console.log("New owner:", drain.owner());
        console.log("Is immutable:", drain.isImmutable());
        console.log("");
        console.log("Contract is now IMMUTABLE. No admin functions available.");
        
        vm.stopBroadcast();
    }
}
