/**
 * Veyrnox Catalog
 * 
 * Single source of truth for models, prices, and provider costs.
 * Source: docs/platform_model_v2.xlsx
 * 
 * All UI code reads from here. Never hardcode prices.
 */

export interface ModelDefinition {
  id: string;
  name: string;
  endpoint: string;
  modality: 'text-to-image' | 'image-to-image' | 'text-to-video' | 'video-to-video' | 'image-to-video' | 'lip-sync';
  inputs: Record<string, ModelParam>;
  credits_5s?: number; // 5s baseline for video/image
  credits_10s?: number; // 2x of 5s
}

export interface ModelParam {
  type: string;
  title: string;
  description?: string;
  default?: any;
  enum?: any[];
  minValue?: number;
  maxValue?: number;
  step?: number;
  examples?: any[];
}

// TODO: Load from docs/platform_model_v2.xlsx via CSV/XLSX parser
// For now: re-export from packages/studio for Phase 1
export * from '../studio/src/models.js';

// Prices: from build brief §7
export const PRICES = {
  models: {
    'wan-2.5': { credits: 15, provider_cost_per_unit: 0.05 },
    'seedance-2.0-fast': { credits: 5, provider_cost_per_unit: 0.01 },
    'seedance-1.0-lite': { credits: 8, provider_cost_per_unit: 0.02 },
    'kling-2.6-pro': { credits: 23, provider_cost_per_unit: 0.08 },
    'kling-3.0': { credits: 33, provider_cost_per_unit: 0.12 },
    'hailuo-02': { credits: 20, provider_cost_per_unit: 0.07 },
    'veo-3.1': { credits: 125, provider_cost_per_unit: 0.40, gated: true },
    'flux-2-pro': { credits: 3, provider_cost_per_unit: 0.01 },
    'seedream-4.5': { credits: 3, provider_cost_per_unit: 0.01 },
    'nano-banana': { credits: 5, provider_cost_per_unit: 0.02 },
  },
  plans: {
    starter: { credits: 200, price_usd: 15 },
    plus: { credits: 1000, price_usd: 39 },
    ultra: { credits: 3000, price_usd: 99 },
  },
  topups: [
    { credits: 200, price_usd: 9 },
    { credits: 500, price_usd: 21 },
    { credits: 1200, price_usd: 45 },
  ],
};

// Provider margin floors: §5.10 gate
export const MARGIN_FLOORS = {
  'fal.ai': 0.5, // 50% floor
  'replicate': 0.45, // 45% floor
};
