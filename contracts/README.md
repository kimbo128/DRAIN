# DRAIN Contracts

Minimal payment channel contract for AI inference micropayments.

## Setup

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Install dependencies
forge install
```

## Build & Test

```bash
forge build
forge test -vvv
```

## Deploy

```bash
# Testnet (Polygon Amoy)
export PRIVATE_KEY=your_private_key
export USDC_ADDRESS=0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582
forge script script/Deploy.s.sol --rpc-url https://rpc-amoy.polygon.technology --broadcast

# Mainnet (Polygon)
export USDC_ADDRESS=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
forge script script/Deploy.s.sol --rpc-url https://polygon-rpc.com --broadcast
```

## Make Immutable

After testing, renounce ownership to make contract trustless:

```bash
export DRAIN_ADDRESS=0x...
forge script script/Deploy.s.sol:RenounceScript --rpc-url $RPC_URL --broadcast
```

⚠️ **This cannot be undone.** Contract becomes fully immutable.

## Contract API

### Admin Functions (before renounce)

| Function | Description |
|----------|-------------|
| `setUSDC(address)` | Update USDC address |
| `renounceOwnership()` | Make contract immutable |
| `isImmutable()` | Check if owner is renounced |

### Channel Functions

| Function | Description |
|----------|-------------|
| `open(provider, amount, duration)` | Open channel, lock USDC |
| `claim(channelId, amount, nonce, signature)` | Provider claims with voucher |
| `close(channelId)` | Consumer refund after expiry |

### Voucher Format (EIP-712)

```solidity
struct Voucher {
    bytes32 channelId;
    uint256 amount;      // Cumulative, not incremental
    uint256 nonce;       // Increasing per claim
}
```

## Lifecycle

```
1. Deploy    → owner = deployer, USDC configurable
2. Test      → setUSDC() if needed
3. Renounce  → owner = 0x0, contract immutable forever
```

## Addresses

| Network | USDC | DrainChannel (V1) | DrainChannelV2 (ERC-8190) |
|---------|------|--------------------|---------------------------|
| Polygon Mainnet | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | [`0x1C1918C99b6DcE977392E4131C91654d8aB71e64`](https://polygonscan.com/address/0x1C1918C99b6DcE977392E4131C91654d8aB71e64) | [`0x0C2B3aA1e80629D572b1f200e6DF3586B3946A8A`](https://polygonscan.com/address/0x0C2B3aA1e80629D572b1f200e6DF3586B3946A8A) |
| Polygon Amoy | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | [`0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C`](https://amoy.polygonscan.com/address/0x61f1C1E04d6Da1C92D0aF1a3d7Dc0fEFc8794d7C) | — |
