// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {DrainChannel} from "../src/DrainChannel.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Mock USDC for testing
contract MockUSDC is IERC20 {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        require(balanceOf[from] >= amount, "Insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract DrainChannelTest is Test {
    DrainChannel public drain;
    MockUSDC public usdc;

    address consumer;
    address provider;
    uint256 consumerPrivateKey;
    uint256 providerPrivateKey;

    uint256 constant DEPOSIT = 100e6; // 100 USDC
    uint256 constant DURATION = 1 days;

    function setUp() public {
        // Create accounts with known private keys
        consumerPrivateKey = 0x1234;
        providerPrivateKey = 0x5678;
        consumer = vm.addr(consumerPrivateKey);
        provider = vm.addr(providerPrivateKey);

        // Deploy mock USDC
        usdc = new MockUSDC();
        
        // Deploy DrainChannel
        drain = new DrainChannel(address(usdc));

        // Fund consumer
        usdc.mint(consumer, 1000e6);
        
        // Approve drain contract
        vm.prank(consumer);
        usdc.approve(address(drain), type(uint256).max);
    }

    // ============ Admin Tests ============

    function test_Constructor() public view {
        assertEq(address(drain.usdc()), address(usdc));
        assertEq(drain.owner(), address(this));
        assertFalse(drain.isImmutable());
    }

    function test_SetUSDC() public {
        MockUSDC newUsdc = new MockUSDC();
        drain.setUSDC(address(newUsdc));
        assertEq(address(drain.usdc()), address(newUsdc));
    }

    function test_SetUSDC_NotOwner_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannel.NotOwner.selector);
        drain.setUSDC(address(usdc));
    }

    function test_RenounceOwnership() public {
        drain.renounceOwnership();
        assertEq(drain.owner(), address(0));
        assertTrue(drain.isImmutable());
    }

    function test_SetUSDC_AfterRenounce_Reverts() public {
        drain.renounceOwnership();
        vm.expectRevert(DrainChannel.NotOwner.selector);
        drain.setUSDC(address(usdc));
    }

    // ============ Open Channel Tests ============

    function test_Open_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.consumer, consumer);
        assertEq(channel.provider, provider);
        assertEq(channel.deposit, DEPOSIT);
        assertEq(channel.claimed, 0);
        assertEq(channel.expiry, block.timestamp + DURATION);
        
        // Check USDC transferred
        assertEq(usdc.balanceOf(address(drain)), DEPOSIT);
        assertEq(usdc.balanceOf(consumer), 1000e6 - DEPOSIT);
    }

    function test_Open_ZeroAmount_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannel.InvalidAmount.selector);
        drain.open(provider, 0, DURATION);
    }

    function test_Open_ZeroProvider_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannel.ZeroAddress.selector);
        drain.open(address(0), DEPOSIT, DURATION);
    }

    // ============ Claim Tests ============

    function test_Claim_Success() public {
        // Open channel
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Create and sign voucher
        uint256 claimAmount = 10e6; // 10 USDC
        uint256 nonce = 1;
        bytes memory signature = _signVoucher(channelId, claimAmount, nonce);

        // Provider claims
        vm.prank(provider);
        drain.claim(channelId, claimAmount, nonce, signature);

        // Check state
        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.claimed, claimAmount);
        assertEq(usdc.balanceOf(provider), claimAmount);
        assertEq(drain.getBalance(channelId), DEPOSIT - claimAmount);
    }

    function test_Claim_PartialThenMore_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // First claim: 10 USDC
        bytes memory sig1 = _signVoucher(channelId, 10e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 10e6, 1, sig1);
        assertEq(usdc.balanceOf(provider), 10e6);

        // Second claim: 25 USDC total (15 USDC more)
        bytes memory sig2 = _signVoucher(channelId, 25e6, 2);
        vm.prank(provider);
        drain.claim(channelId, 25e6, 2, sig2);
        assertEq(usdc.balanceOf(provider), 25e6);
    }

    function test_Claim_NotProvider_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory signature = _signVoucher(channelId, 10e6, 1);

        vm.prank(consumer); // Wrong caller
        vm.expectRevert(DrainChannel.NotProvider.selector);
        drain.claim(channelId, 10e6, 1, signature);
    }

    function test_Claim_OverDeposit_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory signature = _signVoucher(channelId, DEPOSIT + 1, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidAmount.selector);
        drain.claim(channelId, DEPOSIT + 1, 1, signature);
    }

    function test_Claim_InvalidSignature_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Sign with wrong private key
        bytes memory badSig = _signVoucherWithKey(channelId, 10e6, 1, providerPrivateKey);

        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidSignature.selector);
        drain.claim(channelId, 10e6, 1, badSig);
    }

    // ============ Close Tests ============

    function test_Close_AfterExpiry_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Provider claims partial
        bytes memory sig = _signVoucher(channelId, 30e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 30e6, 1, sig);

        // Warp past expiry
        vm.warp(block.timestamp + DURATION + 1);

        // Consumer closes
        uint256 balanceBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        // Check refund
        assertEq(usdc.balanceOf(consumer), balanceBefore + 70e6);
        
        // Channel should be deleted
        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.consumer, address(0));
    }

    function test_Close_BeforeExpiry_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.prank(consumer);
        vm.expectRevert(DrainChannel.NotExpired.selector);
        drain.close(channelId);
    }

    function test_Close_NotConsumer_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(provider); // Wrong caller
        vm.expectRevert(DrainChannel.NotConsumer.selector);
        drain.close(channelId);
    }

    // ============ Multiple Channels ============

    function test_MultipleChannels_SameProviderConsumer() public {
        vm.startPrank(consumer);
        
        bytes32 channelId1 = drain.open(provider, 50e6, DURATION);
        bytes32 channelId2 = drain.open(provider, 30e6, DURATION);
        
        vm.stopPrank();

        assertFalse(channelId1 == channelId2);
        assertEq(drain.getBalance(channelId1), 50e6);
        assertEq(drain.getBalance(channelId2), 30e6);
    }

    // ============ Helpers ============

    function _signVoucher(
        bytes32 channelId,
        uint256 amount,
        uint256 nonce
    ) internal view returns (bytes memory) {
        return _signVoucherWithKey(channelId, amount, nonce, consumerPrivateKey);
    }

    function _signVoucherWithKey(
        bytes32 channelId,
        uint256 amount,
        uint256 nonce,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 voucherHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                drain.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(drain.VOUCHER_TYPEHASH(), channelId, amount, nonce))
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, voucherHash);
        return abi.encodePacked(r, s, v);
    }
}
