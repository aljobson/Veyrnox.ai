/**
 * Presets System — Model + Params Templates
 * 
 * A preset is a saved generation configuration:
 * - Model ID + name
 * - Prompt template
 * Parameters (aspect_ratio, seed, etc.)
 * 
 * Presets v1 (Week 5-8 scope):
 * - 15-20 curated presets (Veyrnox team)
 * - Read-only (no user-created presets in v1)
 * - Cached demo playback (show example outputs)
 * - Client uses presets for quick generation
 */

export interface Preset {
  id: string;
  model_id: string;
  name: string;
  description: string;
  prompt_template: string; // e.g., "A portrait of {{subject}} in {{style}}"
  params: Record<string, any>; // aspect_ratio, seed, steps, etc.
  demo_output_url?: string; // Example generation result (R2)
  created_at: string;
}

export class PresetManager {
  constructor(private db: any) {}

  /**
   * Get all presets (curated set)
   */
  async listPresets(): Promise<Preset[]> {
    const result = await this.db.query(
      `SELECT * FROM presets ORDER BY created_at DESC`
    );
    return result.rows;
  }

  /**
   * Get preset by ID
   */
  async getPreset(presetId: string): Promise<Preset | null> {
    const result = await this.db.query(
      `SELECT * FROM presets WHERE id = $1`,
      [presetId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Get presets by model
   */
  async getPresetsByModel(modelId: string): Promise<Preset[]> {
    const result = await this.db.query(
      `SELECT * FROM presets WHERE model_id = $1 ORDER BY name ASC`,
      [modelId]
    );
    return result.rows;
  }

  /**
   * Create preset (admin only, via CLI)
   */
  async createPreset(preset: Omit<Preset, 'id' | 'created_at'>): Promise<Preset> {
    const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const result = await this.db.query(
      `INSERT INTO presets (id, model_id, name, description, prompt_template, params, demo_output_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING *`,
      [
        id,
        preset.model_id,
        preset.name,
        preset.description,
        preset.prompt_template,
        JSON.stringify(preset.params),
        preset.demo_output_url,
      ]
    );

    return result.rows[0];
  }
}
