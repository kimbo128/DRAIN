/**
 * Wallet Service
 * 
 * Handles wallet operations: balance, approvals, signing.
 */

import { formatUnits, parseUnits, type Address, type Hash, type PublicClient, type WalletClient, type Account } from 'viem';
import { USDC_DECIMALS, ERC20_ABI } from '../constants.js';
import type { DrainConfig } from '../config.js';

export class WalletService {
  constructor(
    private publicClient: PublicClient,
    private walletClient: WalletClient,
    private account: Account,
    private config: DrainConfig
  ) {}

  /**
   * Get the agent's wallet address
   */
  getAddress(): Address {
    return this.account.address;
  }

  /**
   * Get USDC balance
   */
  async getUsdcBalance(): Promise<{ raw: bigint; formatted: string }> {
    const balance = await this.publicClient.readContract({
      address: this.config.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [this.account.address],
    }) as bigint;
    
    return {
      raw: balance,
      formatted: formatUnits(balance, USDC_DECIMALS),
    };
  }

  /**
   * Get current USDC allowance for DRAIN contract
   */
  async getAllowance(): Promise<{ raw: bigint; formatted: string }> {
    const allowance = await this.publicClient.readContract({
      address: this.config.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [this.account.address, this.config.drainAddress],
    }) as bigint;
    
    return {
      raw: allowance,
      formatted: formatUnits(allowance, USDC_DECIMALS),
    };
  }

  /**
   * Approve USDC spending for DRAIN contract
   */
  async approveUsdc(amount: string): Promise<Hash> {
    const amountWei = parseUnits(amount, USDC_DECIMALS);
    
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [this.config.drainAddress, amountWei],
      chain: this.config.chain,
    });
    
    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash });
    
    return hash;
  }

  /**
   * Approve maximum USDC spending (for convenience)
   */
  async approveMax(): Promise<Hash> {
    const maxAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    
    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.usdcAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [this.config.drainAddress, maxAmount],
      chain: this.config.chain,
    });
    
    // Wait for confirmation
    await this.publicClient.waitForTransactionReceipt({ hash });
    
    return hash;
  }

  /**
   * Get native token (POL/MATIC) balance for gas
   */
  async getNativeBalance(): Promise<{ raw: bigint; formatted: string }> {
    const balance = await this.publicClient.getBalance({
      address: this.account.address,
    });
    
    return {
      raw: balance,
      formatted: formatUnits(balance, 18),
    };
  }
}
