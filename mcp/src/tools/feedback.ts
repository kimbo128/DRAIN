/**
 * Feedback Tool
 *
 * Optional quality report after using a provider.
 * Agents report success/failure + optional failure reason.
 */

import type { DrainConfig } from '../config.js';

export async function submitFeedback(
  config: DrainConfig,
  args: {
    providerId: string;
    outcome: 'success' | 'failure';
    reason?: string;
    protocol?: string;
  }
): Promise<string> {
  if (!args.providerId) {
    return 'Error: providerId is required.';
  }
  if (args.outcome !== 'success' && args.outcome !== 'failure') {
    return 'Error: outcome must be "success" or "failure".';
  }

  const validReasons = ['quality', 'timeout', 'error', 'format', 'unavailable'];
  if (args.reason && !validReasons.includes(args.reason)) {
    return `Error: reason must be one of: ${validReasons.join(', ')}`;
  }
  if (args.outcome === 'success' && args.reason) {
    return 'Error: reason should only be provided for failures.';
  }

  const body: Record<string, string> = {
    providerId: args.providerId,
    outcome: args.outcome,
    protocol: args.protocol || 'drain',
  };
  if (args.reason) body.reason = args.reason;

  try {
    const res = await fetch(`${config.marketplaceBaseUrl}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, string>;
      return `Feedback rejected: ${data.error || res.statusText}`;
    }

    return `Feedback submitted: ${args.outcome}${args.reason ? ` (${args.reason})` : ''} for provider ${args.providerId}`;
  } catch {
    return 'Feedback could not be submitted (network error). This is non-critical.';
  }
}

export const feedbackTools = [
  {
    name: 'drain_feedback',
    description: `Report quality feedback for a provider interaction. Optional but encouraged.

Use this after completing a session with a provider to report whether the interaction was successful or not. This helps improve provider quality scores on the marketplace.

For failures, include a reason to help diagnose issues:
- "quality" — output was incorrect or low quality
- "timeout" — provider took too long to respond
- "error" — provider returned an error
- "format" — response format was wrong or unparseable
- "unavailable" — provider was unreachable

Works for both DRAIN and MPP providers.`,
    inputSchema: {
      type: 'object',
      properties: {
        providerId: {
          type: 'string',
          description: 'The provider ID (from drain_providers output)',
        },
        outcome: {
          type: 'string',
          enum: ['success', 'failure'],
          description: 'Whether the interaction was successful',
        },
        reason: {
          type: 'string',
          enum: ['quality', 'timeout', 'error', 'format', 'unavailable'],
          description: 'Failure reason (only for outcome="failure")',
        },
        protocol: {
          type: 'string',
          enum: ['drain', 'mpp'],
          description: 'Protocol used (defaults to "drain")',
        },
      },
      required: ['providerId', 'outcome'],
    },
  },
];
