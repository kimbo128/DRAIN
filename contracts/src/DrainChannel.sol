// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {ECDSA} from "../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

/// @title DrainChannel
/// @notice Minimal payment channels for AI inference micropayments
/// @dev Unidirectional channels with EIP-712 signed vouchers
/// @dev Admin can configure USDC, then renounce to make contract immutable
contract DrainChannel {
    using ECDSA for bytes32;
    // ============ Constants ============

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(bytes32 channelId,uint256 amount,uint256 nonce)");

    // ============ Immutables ============

    /// @notice Cached domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    // ============ Admin State ============

    /// @notice Contract owner (can be renounced)
    address public owner;

    /// @notice USDC token address (configurable until renounced)
    IERC20 public usdc;

    // ============ Channel State ============

    struct Channel {
        address consumer;
        address provider;
        uint256 deposit;
        uint256 claimed;
        uint256 expiry;
    }

    /// @notice All payment channels
    mapping(bytes32 => Channel) public channels;

    /// @notice Nonce per consumer for unique channel IDs
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

    event USDCUpdated(address indexed oldUsdc, address indexed newUsdc);
    event OwnershipRenounced(address indexed previousOwner);

    // ============ Errors ============

    error NotOwner();
    error NoOwner();
    error ZeroAddress();
    error ChannelExists();
    error ChannelNotFound();
    error NotProvider();
    error NotConsumer();
    error NotExpired();
    error InvalidSignature();
    error InvalidAmount();
    error TransferFailed();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // ============ Constructor ============

    /// @param _usdc USDC token address
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

    /// @notice Update USDC address (only before renouncing)
    /// @param _usdc New USDC address
    function setUSDC(address _usdc) external onlyOwner {
        if (_usdc == address(0)) revert ZeroAddress();
        
        address oldUsdc = address(usdc);
        usdc = IERC20(_usdc);
        
        emit USDCUpdated(oldUsdc, _usdc);
    }

    /// @notice Permanently renounce ownership - makes contract immutable
    /// @dev Cannot be undone. Contract becomes trustless after this.
    function renounceOwnership() external onlyOwner {
        address previousOwner = owner;
        owner = address(0);
        
        emit OwnershipRenounced(previousOwner);
    }

    // ============ Channel Functions ============

    /// @notice Open a payment channel
    /// @param provider Address of the AI service provider
    /// @param amount Amount of USDC to deposit
    /// @param duration Channel duration in seconds
    /// @return channelId Unique identifier for the channel
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

        // Transfer USDC from consumer to contract
        bool success = usdc.transferFrom(msg.sender, address(this), amount);
        if (!success) revert TransferFailed();

        emit ChannelOpened(channelId, msg.sender, provider, amount, expiry);
    }

    /// @notice Provider claims payment with signed voucher
    /// @param channelId Channel to claim from
    /// @param amount Cumulative amount to claim (NOT incremental)
    /// @param nonce Voucher nonce (must be increasing)
    /// @param signature Consumer's EIP-712 signature
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

        // Verify signature (using OpenZeppelin ECDSA for malleability protection)
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

        // Calculate payout (only the delta from last claim)
        uint256 payout = amount - channel.claimed;
        channel.claimed = amount;

        // Transfer to provider
        bool success = usdc.transfer(msg.sender, payout);
        if (!success) revert TransferFailed();

        emit ChannelClaimed(channelId, msg.sender, payout);
    }

    /// @notice Consumer closes channel after expiry and claims refund
    /// @param channelId Channel to close
    function close(bytes32 channelId) external {
        Channel storage channel = channels[channelId];

        if (channel.consumer == address(0)) revert ChannelNotFound();
        if (msg.sender != channel.consumer) revert NotConsumer();
        if (block.timestamp < channel.expiry) revert NotExpired();

        uint256 refund = channel.deposit - channel.claimed;
        
        // Clear channel (prevents re-entrancy and double-close)
        delete channels[channelId];

        if (refund > 0) {
            bool success = usdc.transfer(msg.sender, refund);
            if (!success) revert TransferFailed();
        }

        emit ChannelClosed(channelId, msg.sender, refund);
    }

    // ============ View Functions ============

    /// @notice Get channel details
    function getChannel(bytes32 channelId) external view returns (Channel memory) {
        return channels[channelId];
    }

    /// @notice Get remaining balance in channel
    function getBalance(bytes32 channelId) external view returns (uint256) {
        Channel storage channel = channels[channelId];
        return channel.deposit - channel.claimed;
    }

    /// @notice Check if contract is immutable (no owner)
    function isImmutable() external view returns (bool) {
        return owner == address(0);
    }

}
