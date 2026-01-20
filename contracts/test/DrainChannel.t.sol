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

    function test_Constructor_ZeroUSDC_Reverts() public {
        vm.expectRevert(DrainChannel.ZeroAddress.selector);
        new DrainChannel(address(0));
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

    function test_SetUSDC_ZeroAddress_Reverts() public {
        vm.expectRevert(DrainChannel.ZeroAddress.selector);
        drain.setUSDC(address(0));
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

    function test_Open_ZeroDuration() public {
        // Zero duration is allowed - channel expires immediately
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, 0);
        
        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.expiry, block.timestamp);
        
        // Consumer can close immediately
        vm.prank(consumer);
        drain.close(channelId);
    }

    function test_Open_InsufficientBalance_Reverts() public {
        address poorConsumer = address(0x999);
        vm.prank(poorConsumer);
        usdc.approve(address(drain), type(uint256).max);
        
        vm.prank(poorConsumer);
        vm.expectRevert("Insufficient balance");
        drain.open(provider, DEPOSIT, DURATION);
    }

    function test_Open_InsufficientAllowance_Reverts() public {
        address newConsumer = address(0x888);
        usdc.mint(newConsumer, 1000e6);
        // No approval
        
        vm.prank(newConsumer);
        vm.expectRevert("Insufficient allowance");
        drain.open(provider, DEPOSIT, DURATION);
    }

    // ============ Claim Tests ============

    function test_Claim_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        uint256 claimAmount = 10e6;
        uint256 nonce = 1;
        bytes memory signature = _signVoucher(channelId, claimAmount, nonce);

        vm.prank(provider);
        drain.claim(channelId, claimAmount, nonce, signature);

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

    function test_Claim_FullDeposit() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, DEPOSIT, 1);
        vm.prank(provider);
        drain.claim(channelId, DEPOSIT, 1, sig);

        assertEq(usdc.balanceOf(provider), DEPOSIT);
        assertEq(drain.getBalance(channelId), 0);
    }

    function test_Claim_AfterExpiry_Success() public {
        // Provider CAN claim after expiry - this is by design
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 50e6, 1);

        // Warp past expiry
        vm.warp(block.timestamp + DURATION + 1);

        // Provider can still claim
        vm.prank(provider);
        drain.claim(channelId, 50e6, 1, sig);
        assertEq(usdc.balanceOf(provider), 50e6);
    }

    function test_Claim_NotProvider_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory signature = _signVoucher(channelId, 10e6, 1);

        vm.prank(consumer);
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

    function test_Claim_SameAmount_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig1 = _signVoucher(channelId, 10e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 10e6, 1, sig1);

        // Try to claim same amount again
        bytes memory sig2 = _signVoucher(channelId, 10e6, 2);
        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidAmount.selector);
        drain.claim(channelId, 10e6, 2, sig2);
    }

    function test_Claim_LessAmount_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig1 = _signVoucher(channelId, 20e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 20e6, 1, sig1);

        // Try to claim less (old voucher)
        bytes memory sig2 = _signVoucher(channelId, 10e6, 2);
        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidAmount.selector);
        drain.claim(channelId, 10e6, 2, sig2);
    }

    function test_Claim_InvalidSignature_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory badSig = _signVoucherWithKey(channelId, 10e6, 1, providerPrivateKey);

        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidSignature.selector);
        drain.claim(channelId, 10e6, 1, badSig);
    }

    function test_Claim_WrongChannelId_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Sign for wrong channel
        bytes32 fakeChannelId = keccak256("fake");
        bytes memory sig = _signVoucher(fakeChannelId, 10e6, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidSignature.selector);
        drain.claim(channelId, 10e6, 1, sig);
    }

    function test_Claim_WrongAmount_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Sign for 10, claim 20
        bytes memory sig = _signVoucher(channelId, 10e6, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannel.InvalidSignature.selector);
        drain.claim(channelId, 20e6, 1, sig);
    }

    function test_Claim_ChannelNotFound_Reverts() public {
        bytes32 fakeChannelId = keccak256("fake");
        bytes memory sig = _signVoucher(fakeChannelId, 10e6, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannel.ChannelNotFound.selector);
        drain.claim(fakeChannelId, 10e6, 1, sig);
    }

    function test_Claim_AfterClose_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 50e6, 1);

        // Warp past expiry and close
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(consumer);
        drain.close(channelId);

        // Provider tries to claim after close
        vm.prank(provider);
        vm.expectRevert(DrainChannel.ChannelNotFound.selector);
        drain.claim(channelId, 50e6, 1, sig);
    }

    // ============ Close Tests ============

    function test_Close_AfterExpiry_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 30e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 30e6, 1, sig);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 balanceBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        assertEq(usdc.balanceOf(consumer), balanceBefore + 70e6);
        
        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.consumer, address(0));
    }

    function test_Close_NoClaim_FullRefund() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 balanceBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        assertEq(usdc.balanceOf(consumer), balanceBefore + DEPOSIT);
    }

    function test_Close_FullyClaimed_ZeroRefund() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, DEPOSIT, 1);
        vm.prank(provider);
        drain.claim(channelId, DEPOSIT, 1, sig);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 balanceBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        // No refund
        assertEq(usdc.balanceOf(consumer), balanceBefore);
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

        vm.prank(provider);
        vm.expectRevert(DrainChannel.NotConsumer.selector);
        drain.close(channelId);
    }

    function test_Close_Twice_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(consumer);
        drain.close(channelId);

        vm.prank(consumer);
        vm.expectRevert(DrainChannel.ChannelNotFound.selector);
        drain.close(channelId);
    }

    function test_Close_ChannelNotFound_Reverts() public {
        bytes32 fakeChannelId = keccak256("fake");

        vm.prank(consumer);
        vm.expectRevert(DrainChannel.ChannelNotFound.selector);
        drain.close(fakeChannelId);
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

    function test_MultipleChannels_DifferentProviders() public {
        address provider2 = address(0x7777);
        
        vm.startPrank(consumer);
        bytes32 channelId1 = drain.open(provider, 50e6, DURATION);
        bytes32 channelId2 = drain.open(provider2, 30e6, DURATION);
        vm.stopPrank();

        DrainChannel.Channel memory ch1 = drain.getChannel(channelId1);
        DrainChannel.Channel memory ch2 = drain.getChannel(channelId2);
        
        assertEq(ch1.provider, provider);
        assertEq(ch2.provider, provider2);
    }

    // ============ Race Condition Tests ============

    function test_Race_ProviderClaimsThenConsumerCloses() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 60e6, 1);

        vm.warp(block.timestamp + DURATION + 1);

        // Provider claims first
        vm.prank(provider);
        drain.claim(channelId, 60e6, 1, sig);
        assertEq(usdc.balanceOf(provider), 60e6);

        // Consumer closes second
        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);
        assertEq(usdc.balanceOf(consumer), consumerBefore + 40e6);
    }

    function test_Race_ConsumerClosesThenProviderClaims() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 60e6, 1);

        vm.warp(block.timestamp + DURATION + 1);

        // Consumer closes first
        vm.prank(consumer);
        drain.close(channelId);

        // Provider tries to claim - fails because channel deleted
        vm.prank(provider);
        vm.expectRevert(DrainChannel.ChannelNotFound.selector);
        drain.claim(channelId, 60e6, 1, sig);
    }

    // ============ Full Flow Integration Test ============

    function test_FullFlow_HappyPath() public {
        // 1. Consumer opens channel with 100 USDC for 24h
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 24 hours);

        // 2. Simulate usage: Provider delivers, consumer signs vouchers
        // Voucher 1: 5 USDC
        bytes memory sig1 = _signVoucher(channelId, 5e6, 1);
        
        // Voucher 2: 15 USDC total
        bytes memory sig2 = _signVoucher(channelId, 15e6, 2);
        
        // Voucher 3: 30 USDC total
        bytes memory sig3 = _signVoucher(channelId, 30e6, 3);

        // 3. Provider claims mid-session (voucher 2)
        vm.prank(provider);
        drain.claim(channelId, 15e6, 2, sig2);
        assertEq(usdc.balanceOf(provider), 15e6);

        // 4. More usage...
        // Voucher 4: 45 USDC total
        bytes memory sig4 = _signVoucher(channelId, 45e6, 4);

        // 5. Session ends, provider claims final voucher
        vm.prank(provider);
        drain.claim(channelId, 45e6, 4, sig4);
        assertEq(usdc.balanceOf(provider), 45e6);

        // 6. Wait for expiry
        vm.warp(block.timestamp + 24 hours + 1);

        // 7. Consumer closes and gets refund
        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        // Verify final balances
        assertEq(usdc.balanceOf(consumer), consumerBefore + 55e6); // 100 - 45 = 55
        assertEq(usdc.balanceOf(provider), 45e6);
        assertEq(usdc.balanceOf(address(drain)), 0);
    }

    function test_FullFlow_ProviderNeverClaims() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 1 hours);

        // Consumer uses service but provider never claims
        // (maybe provider went offline)

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        // Consumer gets full refund
        assertEq(usdc.balanceOf(consumer), consumerBefore + 100e6);
    }

    function test_FullFlow_ConsumerDisconnects() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 1 hours);

        // Provider delivers, consumer signs voucher then disconnects
        bytes memory sig = _signVoucher(channelId, 25e6, 1);

        // Provider keeps last voucher and claims
        vm.prank(provider);
        drain.claim(channelId, 25e6, 1, sig);
        assertEq(usdc.balanceOf(provider), 25e6);

        // Provider delivered more but consumer never signed
        // Provider loses that value (accepted business risk)

        // Channel expires, remaining funds locked until consumer returns
        // or until expiry when anyone can observe it
    }

    // ============ Fuzz Tests ============

    function testFuzz_Open_AnyAmount(uint256 amount) public {
        // Bound to reasonable range (1 wei to 1 billion USDC)
        amount = bound(amount, 1, 1_000_000_000e6);
        
        usdc.mint(consumer, amount);
        vm.prank(consumer);
        usdc.approve(address(drain), amount);
        
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, amount, DURATION);
        
        assertEq(drain.getBalance(channelId), amount);
    }

    function testFuzz_Open_AnyDuration(uint256 duration) public {
        // Bound to prevent overflow (max ~100 years)
        duration = bound(duration, 0, 365 days * 100);
        
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, duration);
        
        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.expiry, block.timestamp + duration);
    }

    function testFuzz_Claim_AnyValidAmount(uint256 amount) public {
        amount = bound(amount, 1, DEPOSIT);
        
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);
        
        bytes memory sig = _signVoucher(channelId, amount, 1);
        
        vm.prank(provider);
        drain.claim(channelId, amount, 1, sig);
        
        assertEq(usdc.balanceOf(provider), amount);
    }

    function testFuzz_Claim_IncrementalAmounts(uint256 amount1, uint256 amount2) public {
        amount1 = bound(amount1, 1, DEPOSIT / 2);
        amount2 = bound(amount2, amount1 + 1, DEPOSIT);
        
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);
        
        bytes memory sig1 = _signVoucher(channelId, amount1, 1);
        vm.prank(provider);
        drain.claim(channelId, amount1, 1, sig1);
        
        bytes memory sig2 = _signVoucher(channelId, amount2, 2);
        vm.prank(provider);
        drain.claim(channelId, amount2, 2, sig2);
        
        assertEq(usdc.balanceOf(provider), amount2);
    }

    // ============ View Function Tests ============

    function test_GetChannel() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        DrainChannel.Channel memory channel = drain.getChannel(channelId);
        
        assertEq(channel.consumer, consumer);
        assertEq(channel.provider, provider);
        assertEq(channel.deposit, DEPOSIT);
        assertEq(channel.claimed, 0);
    }

    function test_GetBalance() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        assertEq(drain.getBalance(channelId), DEPOSIT);

        bytes memory sig = _signVoucher(channelId, 30e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 30e6, 1, sig);

        assertEq(drain.getBalance(channelId), 70e6);
    }

    function test_Nonces() public {
        assertEq(drain.nonces(consumer), 0);
        
        vm.prank(consumer);
        drain.open(provider, DEPOSIT, DURATION);
        assertEq(drain.nonces(consumer), 1);
        
        vm.prank(consumer);
        drain.open(provider, DEPOSIT, DURATION);
        assertEq(drain.nonces(consumer), 2);
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
