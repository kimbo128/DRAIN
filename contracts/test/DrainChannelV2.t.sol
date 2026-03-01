// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DrainChannelV2} from "../src/DrainChannelV2.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

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

contract DrainChannelV2Test is Test {
    DrainChannelV2 public drain;
    MockUSDC public usdc;

    address consumer;
    address provider;
    address feeWallet;
    uint256 consumerPrivateKey;
    uint256 providerPrivateKey;

    uint256 constant DEPOSIT = 100e6; // 100 USDC
    uint256 constant DURATION = 1 days;
    uint256 constant FEE_BPS = 200; // 2%

    function setUp() public {
        consumerPrivateKey = 0x1234;
        providerPrivateKey = 0x5678;
        consumer = vm.addr(consumerPrivateKey);
        provider = vm.addr(providerPrivateKey);
        feeWallet = address(0xFEE);

        usdc = new MockUSDC();
        drain = new DrainChannelV2(address(usdc));

        usdc.mint(consumer, 1000e6);

        vm.prank(consumer);
        usdc.approve(address(drain), type(uint256).max);
    }

    // ============ Admin Tests ============

    function test_Constructor() public view {
        assertEq(address(drain.usdc()), address(usdc));
        assertEq(drain.owner(), address(this));
        assertFalse(drain.isImmutable());
        assertEq(drain.feeBps(), 0);
        assertEq(drain.feeRecipient(), address(0));
        assertEq(drain.totalLocked(), 0);
    }

    function test_Constructor_ZeroUSDC_Reverts() public {
        vm.expectRevert(DrainChannelV2.ZeroAddress.selector);
        new DrainChannelV2(address(0));
    }

    function test_SetUSDC() public {
        MockUSDC newUsdc = new MockUSDC();
        drain.setUSDC(address(newUsdc));
        assertEq(address(drain.usdc()), address(newUsdc));
    }

    function test_SetUSDC_NotOwner_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.NotOwner.selector);
        drain.setUSDC(address(usdc));
    }

    function test_SetUSDC_ZeroAddress_Reverts() public {
        vm.expectRevert(DrainChannelV2.ZeroAddress.selector);
        drain.setUSDC(address(0));
    }

    function test_RenounceOwnership() public {
        drain.renounceOwnership();
        assertEq(drain.owner(), address(0));
        assertTrue(drain.isImmutable());
    }

    function test_SetUSDC_AfterRenounce_Reverts() public {
        drain.renounceOwnership();
        vm.expectRevert(DrainChannelV2.NotOwner.selector);
        drain.setUSDC(address(usdc));
    }

    // ============ SetFee Tests ============

    function test_SetFee() public {
        drain.setFee(feeWallet, FEE_BPS);
        assertEq(drain.feeRecipient(), feeWallet);
        assertEq(drain.feeBps(), FEE_BPS);
    }

    function test_SetFee_ZeroBps_ZeroRecipient() public {
        drain.setFee(address(0), 0);
        assertEq(drain.feeRecipient(), address(0));
        assertEq(drain.feeBps(), 0);
    }

    function test_SetFee_MaxBps() public {
        drain.setFee(feeWallet, 1000);
        assertEq(drain.feeBps(), 1000);
    }

    function test_SetFee_TooHigh_Reverts() public {
        vm.expectRevert(DrainChannelV2.FeeTooHigh.selector);
        drain.setFee(feeWallet, 1001);
    }

    function test_SetFee_BpsWithoutRecipient_Reverts() public {
        vm.expectRevert(DrainChannelV2.ZeroAddress.selector);
        drain.setFee(address(0), 100);
    }

    function test_SetFee_NotOwner_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.NotOwner.selector);
        drain.setFee(feeWallet, FEE_BPS);
    }

    function test_SetFee_EmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit DrainChannelV2.FeeUpdated(feeWallet, FEE_BPS);
        drain.setFee(feeWallet, FEE_BPS);
    }

    // ============ Open Channel Tests ============

    function test_Open_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.consumer, consumer);
        assertEq(channel.provider, provider);
        assertEq(channel.deposit, DEPOSIT);
        assertEq(channel.claimed, 0);
        assertEq(channel.expiry, block.timestamp + DURATION);

        assertEq(usdc.balanceOf(address(drain)), DEPOSIT);
        assertEq(usdc.balanceOf(consumer), 1000e6 - DEPOSIT);
        assertEq(drain.totalLocked(), DEPOSIT);
    }

    function test_Open_TotalLocked_MultipleChannels() public {
        vm.startPrank(consumer);
        drain.open(provider, 50e6, DURATION);
        drain.open(provider, 30e6, DURATION);
        vm.stopPrank();

        assertEq(drain.totalLocked(), 80e6);
    }

    function test_Open_ZeroAmount_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.InvalidAmount.selector);
        drain.open(provider, 0, DURATION);
    }

    function test_Open_ZeroProvider_Reverts() public {
        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.ZeroAddress.selector);
        drain.open(address(0), DEPOSIT, DURATION);
    }

    function test_Open_ZeroDuration() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, 0);

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.expiry, block.timestamp);

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

        vm.prank(newConsumer);
        vm.expectRevert("Insufficient allowance");
        drain.open(provider, DEPOSIT, DURATION);
    }

    // ============ Claim Tests (No Fee) ============

    function test_Claim_NoFee_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        uint256 claimAmount = 10e6;
        bytes memory signature = _signVoucher(channelId, claimAmount, 1);

        vm.prank(provider);
        drain.claim(channelId, claimAmount, 1, signature);

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.claimed, claimAmount);
        assertEq(usdc.balanceOf(provider), claimAmount);
        assertEq(drain.getBalance(channelId), DEPOSIT - claimAmount);
        assertEq(drain.totalLocked(), DEPOSIT - claimAmount);
    }

    function test_Claim_PartialThenMore_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig1 = _signVoucher(channelId, 10e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 10e6, 1, sig1);
        assertEq(usdc.balanceOf(provider), 10e6);

        bytes memory sig2 = _signVoucher(channelId, 25e6, 2);
        vm.prank(provider);
        drain.claim(channelId, 25e6, 2, sig2);
        assertEq(usdc.balanceOf(provider), 25e6);
        assertEq(drain.totalLocked(), DEPOSIT - 25e6);
    }

    function test_Claim_FullDeposit() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, DEPOSIT, 1);
        vm.prank(provider);
        drain.claim(channelId, DEPOSIT, 1, sig);

        assertEq(usdc.balanceOf(provider), DEPOSIT);
        assertEq(drain.getBalance(channelId), 0);
        assertEq(drain.totalLocked(), 0);
    }

    function test_Claim_AfterExpiry_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 50e6, 1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(provider);
        drain.claim(channelId, 50e6, 1, sig);
        assertEq(usdc.balanceOf(provider), 50e6);
    }

    function test_Claim_NotProvider_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory signature = _signVoucher(channelId, 10e6, 1);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.NotProvider.selector);
        drain.claim(channelId, 10e6, 1, signature);
    }

    function test_Claim_OverDeposit_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory signature = _signVoucher(channelId, DEPOSIT + 1, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.InvalidAmount.selector);
        drain.claim(channelId, DEPOSIT + 1, 1, signature);
    }

    function test_Claim_SameAmount_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig1 = _signVoucher(channelId, 10e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 10e6, 1, sig1);

        bytes memory sig2 = _signVoucher(channelId, 10e6, 2);
        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.InvalidAmount.selector);
        drain.claim(channelId, 10e6, 2, sig2);
    }

    function test_Claim_LessAmount_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig1 = _signVoucher(channelId, 20e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 20e6, 1, sig1);

        bytes memory sig2 = _signVoucher(channelId, 10e6, 2);
        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.InvalidAmount.selector);
        drain.claim(channelId, 10e6, 2, sig2);
    }

    function test_Claim_InvalidSignature_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory badSig = _signVoucherWithKey(channelId, 10e6, 1, providerPrivateKey);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.InvalidSignature.selector);
        drain.claim(channelId, 10e6, 1, badSig);
    }

    function test_Claim_WrongChannelId_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes32 fakeChannelId = keccak256("fake");
        bytes memory sig = _signVoucher(fakeChannelId, 10e6, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.InvalidSignature.selector);
        drain.claim(channelId, 10e6, 1, sig);
    }

    function test_Claim_WrongAmount_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 10e6, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.InvalidSignature.selector);
        drain.claim(channelId, 20e6, 1, sig);
    }

    function test_Claim_ChannelNotFound_Reverts() public {
        bytes32 fakeChannelId = keccak256("fake");
        bytes memory sig = _signVoucher(fakeChannelId, 10e6, 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.claim(fakeChannelId, 10e6, 1, sig);
    }

    function test_Claim_AfterClose_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 50e6, 1);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(consumer);
        drain.close(channelId);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.claim(channelId, 50e6, 1, sig);
    }

    // ============ Claim Tests (With Fee) ============

    function test_Claim_WithFee_Success() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 50e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 50e6, 1, sig);

        uint256 expectedFee = (50e6 * FEE_BPS) / 10000; // 1 USDC
        assertEq(usdc.balanceOf(feeWallet), expectedFee);
        assertEq(usdc.balanceOf(provider), 50e6 - expectedFee);
        assertEq(drain.totalLocked(), DEPOSIT - 50e6);
    }

    function test_Claim_WithFee_MultipleClaims() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig1 = _signVoucher(channelId, 20e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 20e6, 1, sig1);

        uint256 fee1 = (20e6 * FEE_BPS) / 10000; // 0.4 USDC
        assertEq(usdc.balanceOf(feeWallet), fee1);
        assertEq(usdc.balanceOf(provider), 20e6 - fee1);

        bytes memory sig2 = _signVoucher(channelId, 60e6, 2);
        vm.prank(provider);
        drain.claim(channelId, 60e6, 2, sig2);

        uint256 payout2 = 40e6; // incremental
        uint256 fee2 = (payout2 * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(feeWallet), fee1 + fee2);
        assertEq(usdc.balanceOf(provider), 60e6 - fee1 - fee2);
        assertEq(drain.totalLocked(), DEPOSIT - 60e6);
    }

    function test_Claim_WithFee_SmallAmount_ZeroFee() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // 1 unit: fee = (1 * 200) / 10000 = 0 (rounds down)
        bytes memory sig = _signVoucher(channelId, 1, 1);
        vm.prank(provider);
        drain.claim(channelId, 1, 1, sig);

        assertEq(usdc.balanceOf(feeWallet), 0);
        assertEq(usdc.balanceOf(provider), 1);
    }

    function test_Claim_WithFee_EmitsFeePaid() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        uint256 claimAmount = 50e6;
        uint256 expectedFee = (claimAmount * FEE_BPS) / 10000;

        bytes memory sig = _signVoucher(channelId, claimAmount, 1);

        vm.expectEmit(true, true, false, true);
        emit DrainChannelV2.FeePaid(channelId, feeWallet, expectedFee);

        vm.prank(provider);
        drain.claim(channelId, claimAmount, 1, sig);
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

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.consumer, address(0));
        assertEq(drain.totalLocked(), 0);
    }

    function test_Close_NoClaim_FullRefund() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        uint256 balanceBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        assertEq(usdc.balanceOf(consumer), balanceBefore + DEPOSIT);
        assertEq(drain.totalLocked(), 0);
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

        assertEq(usdc.balanceOf(consumer), balanceBefore);
        assertEq(drain.totalLocked(), 0);
    }

    function test_Close_BeforeExpiry_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.NotExpired.selector);
        drain.close(channelId);
    }

    function test_Close_NotConsumer_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.NotConsumer.selector);
        drain.close(channelId);
    }

    function test_Close_Twice_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(consumer);
        drain.close(channelId);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.close(channelId);
    }

    function test_Close_ChannelNotFound_Reverts() public {
        bytes32 fakeChannelId = keccak256("fake");

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.close(fakeChannelId);
    }

    // ============ CooperativeClose Tests ============

    function test_CooperativeClose_Success() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        uint256 finalAmount = 40e6;
        bytes memory providerSig = _signCloseAuth(channelId, finalAmount);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, finalAmount, providerSig);

        assertEq(usdc.balanceOf(provider), finalAmount);
        assertEq(usdc.balanceOf(consumer), consumerBefore + (DEPOSIT - finalAmount));
        assertEq(drain.totalLocked(), 0);

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
        assertEq(channel.consumer, address(0));
    }

    function test_CooperativeClose_WithFee() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        uint256 finalAmount = 50e6;
        bytes memory providerSig = _signCloseAuth(channelId, finalAmount);

        vm.prank(consumer);
        drain.cooperativeClose(channelId, finalAmount, providerSig);

        uint256 expectedFee = (finalAmount * FEE_BPS) / 10000; // 1 USDC
        assertEq(usdc.balanceOf(feeWallet), expectedFee);
        assertEq(usdc.balanceOf(provider), finalAmount - expectedFee);
        assertEq(usdc.balanceOf(consumer), 1000e6 - DEPOSIT + (DEPOSIT - finalAmount));
        assertEq(drain.totalLocked(), 0);
    }

    function test_CooperativeClose_AfterPartialClaim() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Provider claims 20 USDC first
        bytes memory claimSig = _signVoucher(channelId, 20e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 20e6, 1, claimSig);

        uint256 fee1 = (20e6 * FEE_BPS) / 10000;
        uint256 providerAfterClaim = 20e6 - fee1;

        // Now cooperative close at 50 USDC total
        uint256 finalAmount = 50e6;
        bytes memory providerSig = _signCloseAuth(channelId, finalAmount);

        vm.prank(consumer);
        drain.cooperativeClose(channelId, finalAmount, providerSig);

        uint256 payout2 = 30e6; // 50 - 20 already claimed
        uint256 fee2 = (payout2 * FEE_BPS) / 10000;

        assertEq(usdc.balanceOf(feeWallet), fee1 + fee2);
        assertEq(usdc.balanceOf(provider), providerAfterClaim + payout2 - fee2);
        assertEq(drain.totalLocked(), 0);
    }

    function test_CooperativeClose_ZeroFinalAmount() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, 0);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, 0, providerSig);

        assertEq(usdc.balanceOf(provider), 0);
        assertEq(usdc.balanceOf(consumer), consumerBefore + DEPOSIT);
        assertEq(drain.totalLocked(), 0);
    }

    function test_CooperativeClose_FullDeposit() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, DEPOSIT);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, DEPOSIT, providerSig);

        assertEq(usdc.balanceOf(provider), DEPOSIT);
        assertEq(usdc.balanceOf(consumer), consumerBefore); // no refund
        assertEq(drain.totalLocked(), 0);
    }

    function test_CooperativeClose_BeforeExpiry() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, 30e6);

        // No warp needed -- cooperative close works at any time
        vm.prank(consumer);
        drain.cooperativeClose(channelId, 30e6, providerSig);

        assertEq(usdc.balanceOf(provider), 30e6);
        assertEq(drain.totalLocked(), 0);
    }

    function test_CooperativeClose_AfterExpiry() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        vm.warp(block.timestamp + DURATION + 1);

        bytes memory providerSig = _signCloseAuth(channelId, 30e6);

        vm.prank(consumer);
        drain.cooperativeClose(channelId, 30e6, providerSig);

        assertEq(usdc.balanceOf(provider), 30e6);
        assertEq(drain.totalLocked(), 0);
    }

    function test_CooperativeClose_NotConsumer_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, 30e6);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.NotConsumer.selector);
        drain.cooperativeClose(channelId, 30e6, providerSig);
    }

    function test_CooperativeClose_OverDeposit_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, DEPOSIT + 1);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.InvalidAmount.selector);
        drain.cooperativeClose(channelId, DEPOSIT + 1, providerSig);
    }

    function test_CooperativeClose_BelowClaimed_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory claimSig = _signVoucher(channelId, 30e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 30e6, 1, claimSig);

        // Try to cooperative close with finalAmount < claimed
        bytes memory providerSig = _signCloseAuth(channelId, 20e6);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.InvalidAmount.selector);
        drain.cooperativeClose(channelId, 20e6, providerSig);
    }

    function test_CooperativeClose_InvalidSignature_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Sign with consumer key instead of provider key
        bytes memory badSig = _signCloseAuthWithKey(channelId, 30e6, consumerPrivateKey);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.InvalidSignature.selector);
        drain.cooperativeClose(channelId, 30e6, badSig);
    }

    function test_CooperativeClose_ChannelNotFound_Reverts() public {
        bytes32 fakeChannelId = keccak256("fake");
        bytes memory providerSig = _signCloseAuth(fakeChannelId, 30e6);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.cooperativeClose(fakeChannelId, 30e6, providerSig);
    }

    function test_CooperativeClose_Twice_Reverts() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, 30e6);

        vm.prank(consumer);
        drain.cooperativeClose(channelId, 30e6, providerSig);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.cooperativeClose(channelId, 30e6, providerSig);
    }

    function test_CooperativeClose_EmitsEvents() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        uint256 finalAmount = 50e6;
        uint256 expectedFee = (finalAmount * FEE_BPS) / 10000;
        uint256 expectedRefund = DEPOSIT - finalAmount;

        bytes memory providerSig = _signCloseAuth(channelId, finalAmount);

        vm.expectEmit(true, true, false, true);
        emit DrainChannelV2.FeePaid(channelId, feeWallet, expectedFee);
        vm.expectEmit(true, true, false, true);
        emit DrainChannelV2.ChannelClaimed(channelId, provider, finalAmount);
        vm.expectEmit(true, true, false, true);
        emit DrainChannelV2.ChannelClosed(channelId, consumer, expectedRefund);

        vm.prank(consumer);
        drain.cooperativeClose(channelId, finalAmount, providerSig);
    }

    // ============ Sweep Tests ============

    function test_Sweep_ExcessFunds() public {
        // Send extra USDC to the contract directly
        usdc.mint(address(drain), 50e6);

        uint256 ownerBefore = usdc.balanceOf(address(this));
        drain.sweep();

        assertEq(usdc.balanceOf(address(this)), ownerBefore + 50e6);
    }

    function test_Sweep_WithActiveChannel() public {
        vm.prank(consumer);
        drain.open(provider, DEPOSIT, DURATION);

        // Send extra USDC
        usdc.mint(address(drain), 25e6);

        uint256 ownerBefore = usdc.balanceOf(address(this));
        drain.sweep();

        // Only excess swept, not locked funds
        assertEq(usdc.balanceOf(address(this)), ownerBefore + 25e6);
        assertEq(usdc.balanceOf(address(drain)), DEPOSIT);
        assertEq(drain.totalLocked(), DEPOSIT);
    }

    function test_Sweep_NoExcess_Reverts() public {
        vm.prank(consumer);
        drain.open(provider, DEPOSIT, DURATION);

        vm.expectRevert(DrainChannelV2.NoExcess.selector);
        drain.sweep();
    }

    function test_Sweep_EmptyContract_Reverts() public {
        vm.expectRevert(DrainChannelV2.NoExcess.selector);
        drain.sweep();
    }

    function test_Sweep_NotOwner_Reverts() public {
        usdc.mint(address(drain), 50e6);

        vm.prank(consumer);
        vm.expectRevert(DrainChannelV2.NotOwner.selector);
        drain.sweep();
    }

    function test_Sweep_AfterFeeAccumulation() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Claim full deposit
        bytes memory sig = _signVoucher(channelId, DEPOSIT, 1);
        vm.prank(provider);
        drain.claim(channelId, DEPOSIT, 1, sig);

        // totalLocked is now 0, but contract might still have balance from rounding
        // In this case, fee was transferred to feeWallet, so no excess
        // The contract balance should equal totalLocked (0)
        assertEq(drain.totalLocked(), 0);
    }

    function test_Sweep_EmitsEvent() public {
        usdc.mint(address(drain), 50e6);

        vm.expectEmit(true, false, false, true);
        emit DrainChannelV2.Swept(address(this), 50e6);
        drain.sweep();
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
        assertEq(drain.totalLocked(), 80e6);
    }

    function test_MultipleChannels_DifferentProviders() public {
        address provider2 = address(0x7777);

        vm.startPrank(consumer);
        bytes32 channelId1 = drain.open(provider, 50e6, DURATION);
        bytes32 channelId2 = drain.open(provider2, 30e6, DURATION);
        vm.stopPrank();

        DrainChannelV2.Channel memory ch1 = drain.getChannel(channelId1);
        DrainChannelV2.Channel memory ch2 = drain.getChannel(channelId2);

        assertEq(ch1.provider, provider);
        assertEq(ch2.provider, provider2);
        assertEq(drain.totalLocked(), 80e6);
    }

    // ============ Race Condition Tests ============

    function test_Race_ProviderClaimsThenConsumerCloses() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 60e6, 1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(provider);
        drain.claim(channelId, 60e6, 1, sig);
        assertEq(usdc.balanceOf(provider), 60e6);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);
        assertEq(usdc.balanceOf(consumer), consumerBefore + 40e6);
        assertEq(drain.totalLocked(), 0);
    }

    function test_Race_ConsumerClosesThenProviderClaims() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory sig = _signVoucher(channelId, 60e6, 1);

        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(consumer);
        drain.close(channelId);

        vm.prank(provider);
        vm.expectRevert(DrainChannelV2.ChannelNotFound.selector);
        drain.claim(channelId, 60e6, 1, sig);
    }

    function test_Race_CooperativeCloseAfterPartialClaim() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        // Provider claims 30
        bytes memory claimSig = _signVoucher(channelId, 30e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 30e6, 1, claimSig);

        // Provider signs close auth for 30 (same as claimed, no additional payout)
        bytes memory closeSig = _signCloseAuth(channelId, 30e6);
        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, 30e6, closeSig);

        // Consumer gets full refund of unused portion
        assertEq(usdc.balanceOf(consumer), consumerBefore + 70e6);
        assertEq(drain.totalLocked(), 0);
    }

    // ============ Full Flow Integration Tests ============

    function test_FullFlow_HappyPath() public {
        drain.setFee(feeWallet, FEE_BPS);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 24 hours);
        assertEq(drain.totalLocked(), 100e6);

        // Provider claims mid-session
        bytes memory sig2 = _signVoucher(channelId, 15e6, 2);
        vm.prank(provider);
        drain.claim(channelId, 15e6, 2, sig2);

        uint256 fee1 = (15e6 * FEE_BPS) / 10000;
        assertEq(usdc.balanceOf(provider), 15e6 - fee1);
        assertEq(drain.totalLocked(), 85e6);

        // Session ends, cooperative close at 45 total
        bytes memory closeSig = _signCloseAuth(channelId, 45e6);
        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, 45e6, closeSig);

        uint256 payout2 = 30e6; // 45 - 15
        uint256 fee2 = (payout2 * FEE_BPS) / 10000;

        assertEq(usdc.balanceOf(provider), 45e6 - fee1 - fee2);
        assertEq(usdc.balanceOf(feeWallet), fee1 + fee2);
        assertEq(usdc.balanceOf(consumer), consumerBefore + 55e6);
        assertEq(drain.totalLocked(), 0);
        assertEq(usdc.balanceOf(address(drain)), 0);
    }

    function test_FullFlow_ProviderNeverClaims_ConsumerCooperativeCloses() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 1 hours);

        // Provider agrees to close with 0 (no service delivered)
        bytes memory closeSig = _signCloseAuth(channelId, 0);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, 0, closeSig);

        assertEq(usdc.balanceOf(consumer), consumerBefore + 100e6);
        assertEq(drain.totalLocked(), 0);
    }

    function test_FullFlow_ProviderNeverClaims_ConsumerWaitsForExpiry() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 1 hours);

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.close(channelId);

        assertEq(usdc.balanceOf(consumer), consumerBefore + 100e6);
        assertEq(drain.totalLocked(), 0);
    }

    function test_FullFlow_ConsumerDisconnects() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, 100e6, 1 hours);

        bytes memory sig = _signVoucher(channelId, 25e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 25e6, 1, sig);
        assertEq(usdc.balanceOf(provider), 25e6);
        assertEq(drain.totalLocked(), 75e6);
    }

    // ============ TotalLocked Invariant Tests ============

    function test_TotalLocked_AfterOpenClaimClose() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);
        assertEq(drain.totalLocked(), DEPOSIT);

        bytes memory sig = _signVoucher(channelId, 40e6, 1);
        vm.prank(provider);
        drain.claim(channelId, 40e6, 1, sig);
        assertEq(drain.totalLocked(), 60e6);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(consumer);
        drain.close(channelId);
        assertEq(drain.totalLocked(), 0);
    }

    function test_TotalLocked_AfterOpenCooperativeClose() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);
        assertEq(drain.totalLocked(), DEPOSIT);

        bytes memory closeSig = _signCloseAuth(channelId, 60e6);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, 60e6, closeSig);
        assertEq(drain.totalLocked(), 0);
    }

    function test_TotalLocked_MultipleChannels_Mixed() public {
        vm.startPrank(consumer);
        bytes32 ch1 = drain.open(provider, 50e6, DURATION);
        bytes32 ch2 = drain.open(provider, 30e6, DURATION);
        vm.stopPrank();
        assertEq(drain.totalLocked(), 80e6);

        // Claim from ch1
        bytes memory sig1 = _signVoucher(ch1, 20e6, 1);
        vm.prank(provider);
        drain.claim(ch1, 20e6, 1, sig1);
        assertEq(drain.totalLocked(), 60e6);

        // CooperativeClose ch2
        bytes memory closeSig = _signCloseAuth(ch2, 10e6);
        vm.prank(consumer);
        drain.cooperativeClose(ch2, 10e6, closeSig);
        assertEq(drain.totalLocked(), 30e6);

        // Close ch1 after expiry
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(consumer);
        drain.close(ch1);
        assertEq(drain.totalLocked(), 0);
    }

    // ============ View Function Tests ============

    function test_GetChannel() public {
        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
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

    // ============ Fuzz Tests ============

    function testFuzz_Open_AnyAmount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000e6);

        usdc.mint(consumer, amount);
        vm.prank(consumer);
        usdc.approve(address(drain), amount);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, amount, DURATION);

        assertEq(drain.getBalance(channelId), amount);
        assertEq(drain.totalLocked(), amount);
    }

    function testFuzz_Open_AnyDuration(uint256 duration) public {
        duration = bound(duration, 0, 365 days * 100);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, duration);

        DrainChannelV2.Channel memory channel = drain.getChannel(channelId);
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
        assertEq(drain.totalLocked(), DEPOSIT - amount);
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
        assertEq(drain.totalLocked(), DEPOSIT - amount2);
    }

    function testFuzz_Fee_Calculation(uint256 payout, uint256 bps) public {
        payout = bound(payout, 1, 1_000_000_000e6);
        bps = bound(bps, 1, 1000);

        uint256 fee = (payout * bps) / 10000;

        // Fee should never exceed payout
        assertLe(fee, payout);
        // Fee should be <= 10% of payout
        assertLe(fee, payout / 10 + 1); // +1 for rounding
    }

    function testFuzz_CooperativeClose_AnyFinalAmount(uint256 finalAmount) public {
        finalAmount = bound(finalAmount, 0, DEPOSIT);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, finalAmount);

        uint256 consumerBefore = usdc.balanceOf(consumer);
        vm.prank(consumer);
        drain.cooperativeClose(channelId, finalAmount, providerSig);

        assertEq(usdc.balanceOf(provider), finalAmount);
        assertEq(usdc.balanceOf(consumer), consumerBefore + (DEPOSIT - finalAmount));
        assertEq(drain.totalLocked(), 0);
    }

    function testFuzz_CooperativeClose_WithFee(uint256 finalAmount, uint256 bps) public {
        finalAmount = bound(finalAmount, 0, DEPOSIT);
        bps = bound(bps, 1, 1000);

        drain.setFee(feeWallet, bps);

        vm.prank(consumer);
        bytes32 channelId = drain.open(provider, DEPOSIT, DURATION);

        bytes memory providerSig = _signCloseAuth(channelId, finalAmount);

        vm.prank(consumer);
        drain.cooperativeClose(channelId, finalAmount, providerSig);

        uint256 expectedFee = finalAmount > 0 ? (finalAmount * bps) / 10000 : 0;
        uint256 expectedRefund = DEPOSIT - finalAmount;

        assertEq(usdc.balanceOf(feeWallet), expectedFee);
        assertEq(usdc.balanceOf(provider), finalAmount - expectedFee);
        assertEq(drain.totalLocked(), 0);
        // Contract should have no leftover USDC
        assertEq(usdc.balanceOf(address(drain)), 0);
    }

    function testFuzz_TotalLocked_Invariant(uint256 deposit1, uint256 deposit2, uint256 claimAmount) public {
        deposit1 = bound(deposit1, 1, 500_000e6);
        deposit2 = bound(deposit2, 1, 500_000e6);

        usdc.mint(consumer, deposit1 + deposit2);
        vm.prank(consumer);
        usdc.approve(address(drain), deposit1 + deposit2);

        vm.startPrank(consumer);
        bytes32 ch1 = drain.open(provider, deposit1, DURATION);
        bytes32 ch2 = drain.open(provider, deposit2, DURATION);
        vm.stopPrank();

        assertEq(drain.totalLocked(), deposit1 + deposit2);

        claimAmount = bound(claimAmount, 1, deposit1);
        bytes memory sig = _signVoucher(ch1, claimAmount, 1);
        vm.prank(provider);
        drain.claim(ch1, claimAmount, 1, sig);

        assertEq(drain.totalLocked(), deposit1 + deposit2 - claimAmount);

        // Contract balance should always be >= totalLocked
        assertGe(usdc.balanceOf(address(drain)), drain.totalLocked());
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

    function _signCloseAuth(
        bytes32 channelId,
        uint256 finalAmount
    ) internal view returns (bytes memory) {
        return _signCloseAuthWithKey(channelId, finalAmount, providerPrivateKey);
    }

    function _signCloseAuthWithKey(
        bytes32 channelId,
        uint256 finalAmount,
        uint256 privateKey
    ) internal view returns (bytes memory) {
        bytes32 closeHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                drain.DOMAIN_SEPARATOR(),
                keccak256(abi.encode(drain.CLOSE_TYPEHASH(), channelId, finalAmount))
            )
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, closeHash);
        return abi.encodePacked(r, s, v);
    }
}
