/**
 * Veyrnox Gateway Client
 * 
 * All generation requests flow through the Veyrnox backend gateway.
 * This client marshals requests to POST /v1/generations and polls for results.
 * 
 * The browser NEVER holds provider keys and NEVER calls a provider endpoint.
 * See architecture §5.8 invariant.
 */

export interface GenerationRequest {
  model: string;
  prompt: string;
  negative_prompt?: string;
  [key: string]: any; // model-specific params
}

export interface GenerationResult {
  job_id: string;
  status: string;
  output_url?: string;
  error?: string;
}

export class VeyrnoxGateway {
  private baseUrl: string;

  constructor(baseUrl: string = '/api/v1') {
    this.baseUrl = baseUrl;
  }

  /**
   * Submit a generation job.
   * Requires Idempotency-Key header for retry safety.
   */
  async generateImage(params: GenerationRequest, idempotencyKey: string): Promise<GenerationResult> {
    const response = await fetch(`${this.baseUrl}/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Generation failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Poll for generation result.
   * Backend handles provider polling; client just checks status.
   */
  async pollForResult(jobId: string, maxAttempts: number = 300): Promise<GenerationResult> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      const response = await fetch(`${this.baseUrl}/generations/${jobId}`);
      const result: GenerationResult = await response.json();

      if (result.status === 'STORED' || result.status === 'FAILED') {
        return result;
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s poll interval
    }

    throw new Error(`Job ${jobId} timeout after ${maxAttempts} attempts`);
  }
}

export const gateway = new VeyrnoxGateway();
