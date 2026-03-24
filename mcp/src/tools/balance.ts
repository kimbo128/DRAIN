/**
 * Balance Tools
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
  
  let result = `# Wallet Status

**Address:** \`${address}\`
**Network:** ${network}

## Balances
- **USDC:** $${usdcBalance.formatted}
- **POL (for gas):** ${nativeBalance.formatted} POL

## DRAIN Contract
- **Allowance:** $${allowance.formatted} USDC
- **Contract:** \`${config.drainAddress}\`

## Status
${parseFloat(usdcBalance.formatted) > 0 ? '✅' : '⚠️'} USDC Balance: ${parseFloat(usdcBalance.formatted) > 0 ? 'OK' : 'LOW - need USDC to open channels. Get free credits with an invite code at handshake58.com/join/<code>'}
${hasGas ? '✅' : '⚠️'} Gas: ${hasGas ? 'OK' : `LOW - need POL for transactions${parseFloat(usdcBalance.formatted) >= 5 ? ' — requesting from Gas Station...' : '. Fund with $5+ USDC and gas is provided free, or use an invite code at handshake58.com/join/<code>'}`}
${hasAllowance ? '✅' : 'ℹ️'} Allowance: ${hasAllowance ? 'Approved' : 'Not yet approved - will need to approve before opening channel'}
`;

  if (!hasGas && parseFloat(usdcBalance.formatted) >= 5) {
    try {
      const gasRes = await fetch(`${config.marketplaceBaseUrl || 'https://handshake58.com'}/api/gas-station`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const gasData = await gasRes.json() as { success?: boolean; txHash?: string; error?: string };
      if (gasRes.ok && gasData.success) {
        result += `\n🔋 **Gas Station:** 0.1 POL sent automatically! TX: \`${gasData.txHash}\`\nWait ~5 seconds, then proceed with drain_approve and drain_open_channel.`;
      } else if (gasData.error) {
        result += `\nℹ️ Gas Station: ${gasData.error}`;
      }
    } catch {}
  }

  return result;
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
    description: `Check wallet balance, USDC allowance, and readiness for DRAIN protocol.

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

Required before opening payment channels. Only needed once — after approval you can open unlimited channels.
If no amount is specified, approves unlimited spending (recommended).

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
