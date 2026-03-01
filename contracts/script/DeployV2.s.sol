// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {DrainChannelV2} from "../src/DrainChannelV2.sol";

contract DeployV2Script is Script {
    address constant USDC_POLYGON_MAINNET = 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359;
    address constant FEE_WALLET = 0xABC12A8285FbaCe47100891BC1eA3f2EE41BF344;
    uint256 constant FEE_BPS = 200; // 2%

    function run() public {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address usdcAddress = vm.envOr("USDC_ADDRESS", USDC_POLYGON_MAINNET);

        vm.startBroadcast(deployerPrivateKey);

        DrainChannelV2 drain = new DrainChannelV2(usdcAddress);
        drain.setFee(FEE_WALLET, FEE_BPS);

        console.log("=== DRAIN V2 Deployment ===");
        console.log("DrainChannelV2:", address(drain));
        console.log("USDC:", usdcAddress);
        console.log("Owner:", drain.owner());
        console.log("Fee Recipient:", drain.feeRecipient());
        console.log("Fee BPS:", drain.feeBps());
        console.log("Chain ID:", block.chainid);

        vm.stopBroadcast();
    }
}
