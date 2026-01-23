/**
 * Balance Tools
 * 
 * Check wallet balance and status.
 */

import type { WalletService } from '../services/wallet.js';
import type { DrainConfig } from '../config.js';

/**
 * Get wallet balance and status
 */
export async function getBalance(
  walletService: WalletService,
  config: DrainConfig
): Promise<string> {
  const address = walletService.getAddress();
  const usdcBalance = await walletService.getUsdcBalance();
  const nativeBalance = await walletService.getNativeBalance();
  const allowance = await walletService.getAllowance();
  
  const network = config.chainId === 137 ? 'Polygon Mainnet' : 'Polygon Amoy Testnet';
  const hasGas = parseFloat(nativeBalance.formatted) > 0.01;
  const hasAllowance = parseFloat(allowance.formatted) > 0;
  
  return `# Wallet Status

**Address:** \`${address}\`
**Network:** ${network}

## Balances
- **USDC:** $${usdcBalance.formatted}
- **POL (for gas):** ${nativeBalance.formatted} POL

## DRAIN Contract
- **Allowance:** $${allowance.formatted} USDC
- **Contract:** \`${config.drainAddress}\`

## Status
${parseFloat(usdcBalance.formatted) > 0 ? '✅' : '⚠️'} USDC Balance: ${parseFloat(usdcBalance.formatted) > 0 ? 'OK' : 'LOW - need USDC to open channels'}
${hasGas ? '✅' : '⚠️'} Gas: ${hasGas ? 'OK' : 'LOW - need POL for transactions'}
${hasAllowance ? '✅' : 'ℹ️'} Allowance: ${hasAllowance ? 'Approved' : 'Not yet approved - will need to approve before opening channel'}
`;
}

/**
 * Approve USDC spending
 */
export async function approveUsdc(
  walletService: WalletService,
  args: { amount?: string }
): Promise<string> {
  let txHash: string;
  
  if (args.amount) {
    txHash = await walletService.approveUsdc(args.amount);
    return `✅ Approved ${args.amount} USDC for DRAIN contract.\n\nTransaction: \`${txHash}\``;
  } else {
    txHash = await walletService.approveMax();
    return `✅ Approved unlimited USDC for DRAIN contract.\n\nTransaction: \`${txHash}\``;
  }
}

// Tool definitions for MCP
export const balanceTools = [
  {
    name: 'drain_balance',
    description: `Check wallet balance, USDC allowance, and readiness for DRAIN payments.

Use this to verify:
- You have enough USDC to open channels
- You have enough POL for gas fees  
- USDC is approved for the DRAIN contract

Returns: Wallet address, balances, and status indicators.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'drain_approve',
    description: `Approve USDC spending for the DRAIN contract.

This is required before opening payment channels. 
If no amount is specified, approves unlimited spending (recommended for convenience).

Returns: Transaction hash of the approval.`,
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'string',
          description: 'Amount of USDC to approve (e.g., "100"). If omitted, approves unlimited.',
        },
      },
    },
  },
];
