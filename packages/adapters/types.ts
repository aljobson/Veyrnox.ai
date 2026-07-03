/**
 * Provider Adapter Interface — Template for all providers
 * 
 * Each provider (fal.ai, Replicate, etc.) implements this interface.
 * §5.4 invariant: webhook verification method varies by provider:
 * - fal.ai: ed25519 signature against JWKS
 * - Replicate: HMAC-SHA256 (never conflate)
 */

export interface JobSpec {
  job_id: string;
  user_id: string;
  model_id: string;
  prompt: string;
  negative_prompt?: string;
  [key: string]: any;
}

export interface SubmitResult {
  providerJobId: string;      // Provider's internal job ID (e.g., "fal-abcd1234")
  statusUrl: string;          // Webhook URL where provider will POST results
}

export interface VerifiedEvent {
  provider: string;           // 'fal' | 'replicate'
  eventId: string;            // Dedup key
  jobId: string;              // Provider's job ID
  status: string;             // 'completed' | 'failed' | 'queued'
  output?: {
    url: string;              // s3 url or provider's hosted URL
    size?: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface ProviderResult {
  status: string;             // 'completed' | 'failed'
  outputUrl?: string;         // File to download from provider
  actualCost?: number;        // Actual units charged (for margin calc)
  errorCode?: string;
}

export interface ProviderAdapter {
  /**
   * Submit a job to the provider.
   * Must return providerJobId and statusUrl (webhook endpoint).
   */
  submit(job: JobSpec): Promise<SubmitResult>;

  /**
   * Verify webhook signature and extract event.
   * 
   * fal.ai: ed25519 from req.headers['x-fal-signature-256'] against fal's JWKS endpoint
   * Replicate: HMAC-SHA256 from req.headers['x-replicate-signature-sha256']
   * 
   * Returns VerifiedEvent if signature valid, null if forged/absent.
   */
  verifyWebhook(req: Request): Promise<VerifiedEvent | null>;

  /**
   * Parse provider result into standardized format.
   * Extract output URL and actual cost for margin calculation.
   */
  parseResult(evt: VerifiedEvent): ProviderResult;
}
