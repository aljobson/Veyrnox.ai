/**
 * fal.ai Provider Adapter — Wan 2.5 and other models
 * 
 * §5.4 Invariant: ed25519 webhook verification (never HMAC)
 * Signature: req.headers['x-fal-signature-256'] is an ed25519 signature.
 * Verify against fal's JWKS endpoint.
 */

import { ProviderAdapter, JobSpec, SubmitResult, VerifiedEvent, ProviderResult } from './types';

const FAL_JWKS_URL = 'https://rest.alpha.fal.ai/.well-known/jwks.json';
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

// ponytail: per-instance JWKS cache; move to shared KV/Cache if fal rotates faster than 24h.
let jwksCache: { fetchedAt: number; keys: CryptoKey[] } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64ToBytes(s: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function loadFalPublicKeys(): Promise<CryptoKey[]> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(FAL_JWKS_URL);
  if (!res.ok) throw new Error(`fal JWKS fetch failed: ${res.status}`);
  const jwks = await res.json() as { keys: Array<Record<string, string>> };
  const keys: CryptoKey[] = [];
  for (const jwk of jwks.keys || []) {
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) continue;
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
        { name: 'Ed25519' },
        false,
        ['verify']
      );
      keys.push(key);
    } catch { /* skip unusable key */ }
  }
  if (keys.length === 0) throw new Error('fal JWKS contained no usable Ed25519 keys');
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

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
      const rawBody = new Uint8Array(await req.arrayBuffer());
      // fal ships base64 (may or may not be url-safe); accept either.
      const sigBytes = /[-_]/.test(signature) ? b64urlToBytes(signature) : b64ToBytes(signature);
      if (sigBytes.length !== 64) return null;

      const keys = await loadFalPublicKeys();
      let verified = false;
      for (const key of keys) {
        if (await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, rawBody)) {
          verified = true;
          break;
        }
      }
      if (!verified) return null;

      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)) as any;

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
