/**
 * DRAIN Simple Demo - AI Agent Optimized
 * 
 * This is a minimal example showing how to use DRAIN protocol
 * for AI agent-to-agent payments.
 * 
 * Designed for machine readability and AI agent comprehension.
 */

import { createDrainConsumer, CHAIN_IDS } from '@drain-protocol/sdk';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DRAIN_CONTRACT = '0x1C1918C99b6DcE977392E4131C91654d8aB71e64';
const USDC_ADDRESS = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const PROVIDER_ADDRESS = '0xCCf2a94EcC6002b8Dd9d161ef15Bb4ABD5cD9E41'; // DRAIN Reference Provider
const PROVIDER_API_URL = 'https://drain-production-a9d4.up.railway.app';

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
  // STEP 1: Setup wallet
  // Agent should provide private key from secure storage
  const privateKey = process.env.AGENT_PRIVATE_KEY || '0x...';
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  // STEP 2: Create DRAIN consumer
  const consumer = createDrainConsumer(walletClient, account, {
    chainId: CHAIN_IDS.POLYGON_MAINNET,
  });

  console.log('✅ DRAIN consumer created');

  // STEP 3: Approve USDC (first time only, max approval)
  console.log('📝 Approving USDC...');
  await consumer.approveUsdc('10'); // Approve 10 USDC (or use max)
  console.log('✅ USDC approved');

  // STEP 4: Open payment channel
  // Recommended: $0.50 for ~500 requests, $1.00 for ~1000 requests
  console.log('🔓 Opening payment channel...');
  const { channelId } = await consumer.openChannel({
    provider: PROVIDER_ADDRESS,
    amount: '0.50', // $0.50 USDC
    duration: '24h', // 24 hours
  });
  console.log(`✅ Channel opened: ${channelId}`);
  console.log('⚠️  IMPORTANT: Save this channelId for future requests!');

  // STEP 5: Make AI request with payment
  console.log('🤖 Making AI request...');
  
  // Sign voucher (estimated cost: $0.01, actual will be much lower)
  const voucher = await consumer.signVoucher(channelId, '0.01');
  
  // Send request to provider
  const response = await fetch(`${PROVIDER_API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DRAIN-Voucher': JSON.stringify({
        channelId,
        amount: voucher.amount.toString(),
        nonce: voucher.nonce.toString(),
        signature: voucher.signature,
      }),
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: 'What is 2+2? Respond in one word.' }
      ],
    }),
  });

  const data = await response.json();
  console.log('✅ AI Response:', data.choices[0].message.content);
  
  // Check actual cost from response headers
  const actualCost = response.headers.get('X-DRAIN-Cost');
  const remaining = response.headers.get('X-DRAIN-Remaining');
  console.log(`💰 Actual cost: ${actualCost} USDC wei`);
  console.log(`💰 Remaining: ${remaining} USDC wei`);

  // STEP 6: Close channel after expiry (get refund)
  // Note: Can only close after channel expiry (24h in this example)
  console.log('🔒 Channel will expire in 24 hours. Close it then to get refund.');
  // await consumer.closeChannel(channelId); // Uncomment after expiry
  console.log('✅ Demo complete');
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

// ============================================================================
// COST REFERENCE (for AI agents)
// ============================================================================

/**
 * COST BREAKDOWN:
 * 
 * Gas Costs:
 * - USDC Approve: ~$0.02 (one-time)
 * - Channel Open: ~$0.02
 * - Channel Close: ~$0.02
 * 
 * Request Costs:
 * - Per Request: $0.000005 (5 USDC wei)
 * - 20,000 requests possible with $0.10 channel
 * 
 * Total Session Overhead: <$0.05
 * 
 * MINIMUM DEPOSIT RECOMMENDATIONS:
 * - $0.10: Testing (40% gas overhead, ~100 messages)
 * - $0.50: Recommended minimum (8% gas overhead, ~500 messages)
 * - $1.00: Optimal (4% gas overhead, ~1000 messages)
 * - $5.00: Best value (0.8% gas overhead, ~5000 messages)
 */


