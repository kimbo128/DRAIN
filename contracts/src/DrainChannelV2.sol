// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {ECDSA} from "../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

/// @title DrainChannelV2
/// @notice Payment channels for AI inference micropayments with cooperative close and platform fees
/// @dev Unidirectional channels with EIP-712 signed vouchers, on-chain fee deduction, and sweep
contract DrainChannelV2 {
    using ECDSA for bytes32;

    // ============ Constants ============

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(bytes32 channelId,uint256 amount,uint256 nonce)");

    bytes32 public constant CLOSE_TYPEHASH =
        keccak256("CloseAuthorization(bytes32 channelId,uint256 finalAmount)");

    // ============ Immutables ============

    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ Admin State ============

    address public owner;
    IERC20 public usdc;
    address public feeRecipient;
    uint256 public feeBps;
    uint256 public totalLocked;

    // ============ Channel State ============

    struct Channel {
        address consumer;
        address provider;
        uint256 deposit;
        uint256 claimed;
        uint256 expiry;
    }

    mapping(bytes32 => Channel) public channels;
    mapping(address => uint256) public nonces;

    // ============ Events ============

    event ChannelOpened(
        bytes32 indexed channelId,
        address indexed consumer,
        address indexed provider,
        uint256 deposit,
        uint256 expiry
    );

    event ChannelClaimed(
        bytes32 indexed channelId,
        address indexed provider,
        uint256 amount
    );

    event ChannelClosed(
        bytes32 indexed channelId,
        address indexed consumer,
        uint256 refund
    );

    event FeePaid(
        bytes32 indexed channelId,
        address indexed recipient,
        uint256 amount
    );

    event FeeUpdated(address indexed feeRecipient, uint256 feeBps);
    event Swept(address indexed to, uint256 amount);
    event USDCUpdated(address indexed oldUsdc, address indexed newUsdc);
    event OwnershipRenounced(address indexed previousOwner);

    // ============ Errors ============

    error NotOwner();
    error ZeroAddress();
    error ChannelExists();
    error ChannelNotFound();
    error NotProvider();
    error NotConsumer();
    error NotExpired();
    error InvalidSignature();
    error InvalidAmount();
    error TransferFailed();
    error FeeTooHigh();
    error NoExcess();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ============ Constructor ============

    constructor(address _usdc) {
        if (_usdc == address(0)) revert ZeroAddress();

        owner = msg.sender;
        usdc = IERC20(_usdc);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("DrainChannel"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ============ Admin Functions ============

    function setUSDC(address _usdc) external onlyOwner {
        if (_usdc == address(0)) revert ZeroAddress();
        address oldUsdc = address(usdc);
        usdc = IERC20(_usdc);
        emit USDCUpdated(oldUsdc, _usdc);
    }

    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        emit OwnershipRenounced(previousOwner);
    }

    function setFee(address _feeRecipient, uint256 _feeBps) external onlyOwner {
        if (_feeBps > 1000) revert FeeTooHigh();
        if (_feeBps > 0 && _feeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = _feeRecipient;
        feeBps = _feeBps;
        emit FeeUpdated(_feeRecipient, _feeBps);
    }

    function sweep() external onlyOwner {
        uint256 balance = usdc.balanceOf(address(this));
        if (balance <= totalLocked) revert NoExcess();
        uint256 excess = balance - totalLocked;
        bool success = usdc.transfer(msg.sender, excess);
        if (!success) revert TransferFailed();
        emit Swept(msg.sender, excess);
    }

    // ============ Channel Functions ============

    function open(
        address provider,
        uint256 amount,
        uint256 duration
    ) external returns (bytes32 channelId) {
        if (amount == 0) revert InvalidAmount();
        if (provider == address(0)) revert ZeroAddress();

        uint256 nonce = nonces[msg.sender]++;
        uint256 expiry = block.timestamp + duration;

        channelId = keccak256(
            abi.encodePacked(msg.sender, provider, block.timestamp, nonce)
        );

        if (channels[channelId].consumer != address(0)) revert ChannelExists();

        channels[channelId] = Channel({
            consumer: msg.sender,
            provider: provider,
            deposit: amount,
            claimed: 0,
            expiry: expiry
        });

        totalLocked += amount;

        bool success = usdc.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        emit ChannelOpened(channelId, msg.sender, provider, amount, expiry);
    }

    function claim(
        bytes32 channelId,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external {
        Channel storage channel = channels[channelId];

        if (channel.consumer == address(0)) revert ChannelNotFound();
        if (msg.sender != channel.provider) revert NotProvider();
        if (amount > channel.deposit) revert InvalidAmount();
        if (amount <= channel.claimed) revert InvalidAmount();

        bytes32 voucherHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, amount, nonce))
            )
        );

        (address signer, ECDSA.RecoverError error) = ECDSA.tryRecover(voucherHash, signature);
        if (error != ECDSA.RecoverError.NoError || signer != channel.consumer) {
            revert InvalidSignature();
        }

        uint256 payout = amount - channel.claimed;
        channel.claimed = amount;
        totalLocked -= payout;

        uint256 fee = 0;
        if (feeBps > 0 && feeRecipient != address(0)) {
            fee = (payout * feeBps) / 10000;
        }

        if (fee > 0) {
            bool feeSuccess = usdc.transfer(feeRecipient, fee);
            if (!feeSuccess) revert TransferFailed();
            emit FeePaid(channelId, feeRecipient, fee);
        }

        bool success = usdc.transfer(msg.sender, payout - fee);
        if (!success) revert TransferFailed();

        emit ChannelClaimed(channelId, msg.sender, payout);
    }

    function close(bytes32 channelId) external {
        Channel storage channel = channels[channelId];

        if (channel.consumer == address(0)) revert ChannelNotFound();
        if (msg.sender != channel.consumer) revert NotConsumer();
        if (block.timestamp < channel.expiry) revert NotExpired();

        uint256 refund = channel.deposit - channel.claimed;

        delete channels[channelId];
        totalLocked -= refund;

        if (refund > 0) {
            bool success = usdc.transfer(msg.sender, refund);
            if (!success) revert TransferFailed();
        }

        emit ChannelClosed(channelId, msg.sender, refund);
    }

    function cooperativeClose(
        bytes32 channelId,
        uint256 finalAmount,
        bytes calldata providerSignature
    ) external {
        Channel storage channel = channels[channelId];

        if (channel.consumer == address(0)) revert ChannelNotFound();
        if (msg.sender != channel.consumer) revert NotConsumer();
        if (finalAmount > channel.deposit) revert InvalidAmount();
        if (finalAmount < channel.claimed) revert InvalidAmount();

        bytes32 closeHash = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(CLOSE_TYPEHASH, channelId, finalAmount))
            )
        );

        (address signer, ECDSA.RecoverError error) = ECDSA.tryRecover(closeHash, providerSignature);
        if (error != ECDSA.RecoverError.NoError || signer != channel.provider) {
            revert InvalidSignature();
        }

        uint256 payout = finalAmount - channel.claimed;
        uint256 refund = channel.deposit - finalAmount;
        address providerAddr = channel.provider;

        delete channels[channelId];
        totalLocked -= (payout + refund);

        uint256 fee = 0;
        if (payout > 0 && feeBps > 0 && feeRecipient != address(0)) {
            fee = (payout * feeBps) / 10000;
        }

        if (payout > 0) {
            if (fee > 0) {
                bool feeSuccess = usdc.transfer(feeRecipient, fee);
                if (!feeSuccess) revert TransferFailed();
                emit FeePaid(channelId, feeRecipient, fee);
            }

            bool paySuccess = usdc.transfer(providerAddr, payout - fee);
            if (!paySuccess) revert TransferFailed();

            emit ChannelClaimed(channelId, providerAddr, payout);
        }

        if (refund > 0) {
            bool refundSuccess = usdc.transfer(msg.sender, refund);
            if (!refundSuccess) revert TransferFailed();
        }

        emit ChannelClosed(channelId, msg.sender, refund);
    }

    // ============ View Functions ============

    function getChannel(bytes32 channelId) external view returns (Channel memory) {
        return channels[channelId];
    }

    function getBalance(bytes32 channelId) external view returns (uint256) {
        Channel storage channel = channels[channelId];
        return channel.deposit - channel.claimed;
    }

    function isImmutable() external view returns (bool) {
        return owner == address(0);
    }
}
