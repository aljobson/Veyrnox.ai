/**
 * Replicate Provider Adapter
 * 
 * §5.4 Invariant: HMAC-SHA256 webhook verification (different from fal.ai ed25519)
 * Signature: x-replicate-signature from request headers
 * Compute: HMAC-SHA256(api_token, body)
 * 
 * Models (failover for fal.ai):
 * - Seedance 1.0 Lite (cheaper alternative to Seedance 2.0)
 * - Kling 2.6 Pro (backup for fal)
 * - Generic fallback for any model Replicate supports
 */

import crypto from 'crypto';
import { ProviderAdapter, JobSpec, SubmitResult, VerifiedEvent, ProviderResult } from './types';

export class ReplicateAdapter implements ProviderAdapter {
  private apiToken: string;
  private baseUrl = 'https://api.replicate.com/v1';
  private webhookSecret: string;

  constructor(apiToken: string, webhookSecret: string) {
    this.apiToken = apiToken;
    this.webhookSecret = webhookSecret;
  }

  /**
   * Submit to Replicate
   * 
   * Maps model_id to Replicate model version (URI).
   * Replicate uses polling + webhooks for results.
   */
  async submit(job: JobSpec): Promise<SubmitResult> {
    const model = this.modelToReplicateVersion(job.model_id);
    const url = `${this.baseUrl}/predictions`;

    const payload = {
      version: model,
      input: {
        prompt: job.prompt,
        negative_prompt: job.negative_prompt,
        // TODO: Map other params (aspect_ratio, seed, etc.)
      },
      webhook: `${job.webhook_url}?provider=replicate&job_id=${job.job_id}`,
      webhook_events_filter: ['completed', 'failed'],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Replicate submit failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return {
      providerJobId: data.id,
      statusUrl: `${this.baseUrl}/predictions/${data.id}`,
    };
  }

  /**
   * Verify Replicate webhook signature
   * 
   * §5.4 Invariant: HMAC-SHA256 (different from fal.ai ed25519)
   * Signature: x-replicate-signature header
   * Compute: HMAC-SHA256(webhook_secret, body)
   */
  async verifyWebhook(req: Request): Promise<VerifiedEvent | null> {
    const signature = req.headers.get('x-replicate-signature');
    if (!signature) return null;

    try {
      const body = await req.text();
      const event = JSON.parse(body);

      // Compute expected signature
      const hmac = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(body)
        .digest('hex');

      // Constant-time comparison
      if (!constantTimeEqual(hmac, signature)) {
        console.warn('Replicate signature mismatch');
        return null;
      }

      // Parse event
      const prediction = event;
      return {
        provider: 'replicate',
        eventId: prediction.id,
        jobId: prediction.id,
        status: prediction.status === 'succeeded' ? 'completed' : prediction.status === 'failed' ? 'failed' : 'queued',
        output: prediction.status === 'succeeded' ? {
          url: prediction.output?.[0] || prediction.output || '',
        } : undefined,
        error: prediction.error ? {
          code: prediction.error.type || 'unknown',
          message: prediction.error.message || '',
        } : undefined,
      };
    } catch (error) {
      console.error('Replicate webhook verification failed:', error);
      return null;
    }
  }

  /**
   * Parse Replicate result
   */
  parseResult(evt: VerifiedEvent): ProviderResult {
    return {
      status: evt.status === 'completed' ? 'completed' : 'failed',
      outputUrl: evt.output?.url,
      actualCost: 1, // TODO: Parse from Replicate response
      errorCode: evt.error?.code,
    };
  }

  /**
   * Map Veyrnox model_id to Replicate model version URI
   */
  private modelToReplicateVersion(modelId: string): string {
    const versions: Record<string, string> = {
      'seedance-1.0-lite': 'stability-ai/stable-diffusion-3:...',
      'kling-2.6-pro': 'replicate/kling-video:...',
      // TODO: Add all failover models
      // Default: generic SD3 for fallback
    };
    return versions[modelId] || 'stability-ai/stable-diffusion-3:latest';
  }
}

/**
 * Constant-time string comparison
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  
  let equal = 0;
  for (let i = 0; i < a.length; i++) {
    equal |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return equal === 0;
}
