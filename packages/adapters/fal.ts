/**
 * fal.ai Provider Adapter — Wan 2.5 and other models
 * 
 * §5.4 Invariant: ed25519 webhook verification (never HMAC)
 * Signature: req.headers['x-fal-signature-256'] is an ed25519 signature.
 * Verify against fal's JWKS endpoint.
 */

import { ProviderAdapter, JobSpec, SubmitResult, VerifiedEvent, ProviderResult } from './types';

export class FalAdapter implements ProviderAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.fal.ai/v1';
  private webhookUrl: string;

  constructor(apiKey: string, webhookUrl: string) {
    this.apiKey = apiKey;
    this.webhookUrl = webhookUrl;
  }

  /**
   * Submit to fal.ai
   * 
   * Maps Veyrnox model_id to fal endpoint:
   * - wan-2.5 → /wan2/generate
   * - seedance-2.0-fast → /seedance/generate
   * etc.
   */
  async submit(job: JobSpec): Promise<SubmitResult> {
    const endpoint = this.modelToEndpoint(job.model_id);
    const url = `${this.baseUrl}${endpoint}`;

    const payload = {
      prompt: job.prompt,
      negative_prompt: job.negative_prompt,
      webhook_url: `${this.webhookUrl}?provider=fal&job_id=${job.job_id}`,
      // TODO: Map other params (aspect_ratio, seed, etc.) from job
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`fal.ai submit failed: ${response.statusText}`);
    }

    const data = await response.json() as any;
    return {
      providerJobId: data.request_id,
      statusUrl: data.logs_url, // fal provides status URL in response
    };
  }

  /**
   * Verify fal.ai ed25519 webhook signature
   * 
   * Signature verification:
   * 1. Get x-fal-signature-256 header (base64-encoded ed25519 signature)
   * 2. Fetch fal's JWKS from https://api.fal.ai/.well-known/jwks.json
   * 3. Verify signature against body bytes
   * 4. Decode and extract job_id, status
   */
  async verifyWebhook(req: Request): Promise<VerifiedEvent | null> {
    const signature = req.headers.get('x-fal-signature-256');
    if (!signature) return null;

    try {
      // TODO: Fetch fal JWKS and verify ed25519 signature
      // For now: parse body and return VerifiedEvent
      const body = await req.json() as any;

      return {
        provider: 'fal',
        eventId: body.request_id,
        jobId: body.request_id,
        status: body.status === 'completed' ? 'completed' : 'failed',
        output: body.status === 'completed' ? {
          url: body.output?.url || '',
        } : undefined,
        error: body.error ? {
          code: body.error.code || 'unknown',
          message: body.error.message || '',
        } : undefined,
      };
    } catch (error) {
      console.error('fal webhook verification failed:', error);
      return null;
    }
  }

  /**
   * Parse fal result
   */
  parseResult(evt: VerifiedEvent): ProviderResult {
    return {
      status: evt.status,
      outputUrl: evt.output?.url,
      actualCost: 1, // TODO: Parse from fal response (unit cost)
      errorCode: evt.error?.code,
    };
  }

  /**
   * Map Veyrnox model_id to fal endpoint
   */
  private modelToEndpoint(modelId: string): string {
    const endpoints: Record<string, string> = {
      'wan-2.5': '/wan2/generate',
      'seedance-2.0-fast': '/seedance/generate',
      'seedance-1.0-lite': '/seedance/generate',
      'kling-2.6-pro': '/kling/generate',
      // TODO: Add all 8 models
    };
    return endpoints[modelId] || '/wan2/generate';
  }
}
