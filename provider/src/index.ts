/**
 * DRAIN Reference Provider
 * 
 * OpenAI-compatible API that accepts DRAIN payments.
 */

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { loadConfig, calculateCost, getModelPricing, isModelSupported, getSupportedModels } from './config.js';
import { DrainService } from './drain.js';
import { VoucherStorage } from './storage.js';
import type { ProviderConfig } from './types.js';
import { formatUnits } from 'viem';

// Load configuration
const config = loadConfig();

// Initialize services
const storage = new VoucherStorage(config.storagePath);
const drainService = new DrainService(config, storage);
const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

/**
 * GET /v1/pricing
 * Returns pricing information for all models
 */
app.get('/v1/pricing', (req, res) => {
  const pricing: Record<string, { inputPer1kTokens: string; outputPer1kTokens: string }> = {};
  
  for (const model of getSupportedModels(config)) {
    const modelPricing = getModelPricing(config, model);
    if (modelPricing) {
      pricing[model] = {
        inputPer1kTokens: formatUnits(modelPricing.inputPer1k, 6),
        outputPer1kTokens: formatUnits(modelPricing.outputPer1k, 6),
      };
    }
  }

  res.json({
    provider: drainService.getProviderAddress(),
    chainId: config.chainId,
    currency: 'USDC',
    decimals: 6,
    models: pricing,
  });
});

/**
 * GET /v1/models
 * OpenAI-compatible models endpoint
 */
app.get('/v1/models', (req, res) => {
  const models = getSupportedModels(config).map(id => ({
    id,
    object: 'model',
    created: Date.now(),
    owned_by: 'drain-provider',
  }));

  res.json({
    object: 'list',
    data: models,
  });
});

/**
 * POST /v1/chat/completions
 * OpenAI-compatible chat endpoint with DRAIN payments
 */
app.post('/v1/chat/completions', async (req, res) => {
  const voucherHeader = req.headers['x-drain-voucher'] as string | undefined;
  
  // 1. Check voucher header present
  if (!voucherHeader) {
    res.status(402).set({
      'X-DRAIN-Error': 'voucher_required',
    }).json({
      error: {
        message: 'X-DRAIN-Voucher header required',
        type: 'payment_required',
        code: 'voucher_required',
      },
    });
    return;
  }

  // 2. Parse voucher
  const voucher = drainService.parseVoucherHeader(voucherHeader);
  if (!voucher) {
    res.status(402).set({
      'X-DRAIN-Error': 'invalid_voucher_format',
    }).json({
      error: {
        message: 'Invalid X-DRAIN-Voucher format',
        type: 'payment_required',
        code: 'invalid_voucher_format',
      },
    });
    return;
  }

  // 3. Check model supported
  const model = req.body.model as string;
  if (!isModelSupported(config, model)) {
    res.status(400).json({
      error: {
        message: `Model '${model}' not supported. Available: ${getSupportedModels(config).join(', ')}`,
        type: 'invalid_request_error',
        code: 'model_not_supported',
      },
    });
    return;
  }

  const pricing = getModelPricing(config, model)!;
  const isStreaming = req.body.stream === true;

  // 4. Pre-auth check: estimate minimum cost
  // Rough estimate: input tokens from messages + minimum output
  const estimatedInputTokens = JSON.stringify(req.body.messages).length / 4;
  const minOutputTokens = 50;
  const estimatedMinCost = calculateCost(pricing, Math.ceil(estimatedInputTokens), minOutputTokens);

  // 5. Validate voucher with estimated cost
  const validation = await drainService.validateVoucher(voucher, estimatedMinCost);
  
  if (!validation.valid) {
    const errorHeaders: Record<string, string> = {
      'X-DRAIN-Error': validation.error!,
    };
    
    if (validation.error === 'insufficient_funds' && validation.channel) {
      errorHeaders['X-DRAIN-Required'] = estimatedMinCost.toString();
      errorHeaders['X-DRAIN-Provided'] = (BigInt(voucher.amount) - validation.channel.totalCharged).toString();
    }
    
    res.status(402).set(errorHeaders).json({
      error: {
        message: `Payment validation failed: ${validation.error}`,
        type: 'payment_required',
        code: validation.error,
      },
    });
    return;
  }

  const channelState = validation.channel!;

  try {
    if (isStreaming) {
      // === STREAMING RESPONSE ===
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-DRAIN-Channel', voucher.channelId);

      const stream = await openai.chat.completions.create({
        ...req.body,
        stream: true,
      });

      let outputTokens = 0;
      let inputTokens = 0;
      let fullContent = '';

      for await (const chunk of stream) {
        // Track content for token counting
        const content = chunk.choices[0]?.delta?.content || '';
        fullContent += content;

        // Send chunk to client
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // Check for usage in final chunk
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      // Estimate tokens if not provided (rough estimate)
      if (inputTokens === 0) {
        inputTokens = Math.ceil(JSON.stringify(req.body.messages).length / 4);
      }
      if (outputTokens === 0) {
        outputTokens = Math.ceil(fullContent.length / 4);
      }

      // Calculate final cost
      const actualCost = calculateCost(pricing, inputTokens, outputTokens);
      
      // Store voucher with actual cost
      drainService.storeVoucher(voucher, channelState, actualCost);

      // Send final cost info as SSE comment
      const remaining = channelState.deposit - channelState.totalCharged - actualCost;
      res.write(`data: [DONE]\n\n`);
      res.write(`: X-DRAIN-Cost: ${actualCost.toString()}\n`);
      res.write(`: X-DRAIN-Total: ${(channelState.totalCharged + actualCost).toString()}\n`);
      res.write(`: X-DRAIN-Remaining: ${remaining.toString()}\n`);
      
      res.end();
    } else {
      // === NON-STREAMING RESPONSE ===
      const completion = await openai.chat.completions.create(req.body);

      // Get actual token counts
      const inputTokens = completion.usage?.prompt_tokens ?? 0;
      const outputTokens = completion.usage?.completion_tokens ?? 0;

      // Calculate actual cost
      const actualCost = calculateCost(pricing, inputTokens, outputTokens);

      // Verify voucher covers actual cost
      const actualValidation = await drainService.validateVoucher(voucher, actualCost);
      
      if (!actualValidation.valid) {
        // This shouldn't happen if pre-auth worked, but handle it
        res.status(402).set({
          'X-DRAIN-Error': 'insufficient_funds_post',
          'X-DRAIN-Required': actualCost.toString(),
        }).json({
          error: {
            message: 'Voucher insufficient for actual cost',
            type: 'payment_required',
            code: 'insufficient_funds_post',
          },
        });
        return;
      }

      // Store voucher
      drainService.storeVoucher(voucher, channelState, actualCost);

      // Calculate remaining
      const remaining = channelState.deposit - channelState.totalCharged - actualCost;

      // Send response with DRAIN headers
      res.set({
        'X-DRAIN-Cost': actualCost.toString(),
        'X-DRAIN-Total': (channelState.totalCharged + actualCost).toString(),
        'X-DRAIN-Remaining': remaining.toString(),
        'X-DRAIN-Channel': voucher.channelId,
      }).json(completion);
    }
  } catch (error) {
    console.error('OpenAI API error:', error);
    
    const message = error instanceof Error ? error.message : 'OpenAI API error';
    res.status(500).json({
      error: {
        message,
        type: 'api_error',
        code: 'openai_error',
      },
    });
  }
});

/**
 * POST /v1/admin/claim
 * Trigger payment claims (should be protected in production)
 */
app.post('/v1/admin/claim', async (req, res) => {
  try {
    const txHashes = await drainService.claimPayments();
    res.json({
      success: true,
      claimed: txHashes.length,
      transactions: txHashes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Claim failed',
    });
  }
});

/**
 * GET /v1/admin/stats
 * Get provider statistics
 */
app.get('/v1/admin/stats', (req, res) => {
  const stats = storage.getStats();
  res.json({
    provider: drainService.getProviderAddress(),
    chainId: config.chainId,
    ...stats,
    totalEarned: formatUnits(stats.totalEarned, 6) + ' USDC',
  });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', provider: drainService.getProviderAddress() });
});

// Start server
app.listen(config.port, config.host, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              DRAIN Reference Provider                         ║
╠═══════════════════════════════════════════════════════════════╣
║  Server:    http://${config.host}:${config.port}                              ║
║  Provider:  ${drainService.getProviderAddress()}  ║
║  Chain:     ${config.chainId === 137 ? 'Polygon Mainnet' : 'Polygon Amoy (Testnet)'}                          ║
║  Models:    ${getSupportedModels(config).join(', ')}            ║
╚═══════════════════════════════════════════════════════════════╝

Endpoints:
  GET  /v1/pricing           - View pricing
  GET  /v1/models            - List models
  POST /v1/chat/completions  - Chat (requires X-DRAIN-Voucher header)
  POST /v1/admin/claim       - Claim pending payments
  GET  /v1/admin/stats       - View statistics
  GET  /health               - Health check
`);
});
