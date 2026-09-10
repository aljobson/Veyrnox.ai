/**
 * Margin Floor Validator — §5.10 Invariant
 * 
 * Every model has a margin_floor (minimum markup).
 * Validation: actual_cost × (1 + margin_floor) ≥ catalog_price
 * 
 * Example: Wan 2.5
 * - catalog_price: 15 credits
 * - provider_cost_per_unit: 0.05 (fal.ai units)
 * - margin_floor: 0.5 (50% minimum markup)
 * - Validation: 0.05 × 1.5 = 0.075 ≤ 15 ✓ (passes, huge margin)
 * 
 * This catches pricing errors: if actual cost per unit changes,
 * the sentinel cron alerts (Week 9: §16.9 backstop).
 */

export interface MarginFloor {
  model_id: string;
  provider: string;
  provider_cost_per_unit: number;
  margin_floor: number; // 0.5 = 50% minimum markup
}

export class MarginValidator {
  /**
   * Validate that catalog price meets margin floor
   * 
   * actual_cost_per_unit × (1 + margin_floor) ≥ catalog_price
   * 
   * Returns: { valid, required_cost, actual_cost, margin_pct }
   */
  static validate(
    catalogPrice: number,
    actualCostPerUnit: number,
    marginFloor: number
  ): {
    valid: boolean;
    requiredMinCost: number;
    actualCost: number;
    achievedMarginPct: number;
  } {
    const requiredMinCost = actualCostPerUnit * (1 + marginFloor);
    const achievedMarginPct = (catalogPrice - actualCostPerUnit) / actualCostPerUnit;
    const valid = requiredMinCost <= catalogPrice;

    return {
      valid,
      requiredMinCost,
      actualCost: actualCostPerUnit,
      achievedMarginPct: Math.round(achievedMarginPct * 100),
    };
  }

  /**
   * Batch validate all models against catalog
   */
  static validateBatch(
    models: Array<{
      model_id: string;
      credits: number;
      provider_cost: number;
      margin_floor: number;
    }>
  ): Array<{
    model_id: string;
    valid: boolean;
    margin_pct: number;
    error?: string;
  }> {
    return models.map(m => {
      const result = this.validate(m.credits, m.provider_cost, m.margin_floor);
      return {
        model_id: m.model_id,
        valid: result.valid,
        margin_pct: result.achievedMarginPct,
        error: !result.valid ? `Margin floor breach: need ${result.requiredMinCost.toFixed(2)} credits, got ${m.credits}` : undefined,
      };
    });
  }
}
