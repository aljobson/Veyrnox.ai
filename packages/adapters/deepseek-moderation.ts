/**
 * DeepSeek Moderation Adapter — Pre-Debit Classifier
 * 
 * §5.6 Invariant: Moderation runs BEFORE debit.
 * Failed prompt = zero charge, plain-language category, no lecture.
 * 
 * Flow:
 * 1. User submits prompt
 * 2. DeepSeek classifier: ACCEPTED | REJECTED
 * 3. If REJECTED: return error category + message (cost = 0)
 * 4. If ACCEPTED: proceed to debit → generation
 * 
 * Categories:
 * - violence: Weapons, gore, self-harm
 * - sexual: Adult content
 * - hate: Discrimination, slurs
 * - illegal: Drugs, hacking, fraud
 * - spam: Repetitive, nonsensical
 * - other: Other policy violations
 */

export interface ModerationRequest {
  prompt: string;
  negative_prompt?: string;
}

export interface ModerationResult {
  allowed: boolean;
  category?: string; // violation category (if rejected)
  confidence?: number; // 0-1 confidence score
  message?: string; // User-friendly explanation
}

export class DeepseekModerationAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.deepseek.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Classify prompt for policy violations
   * 
   * Returns: { allowed: boolean, category?: string, message?: string }
   * 
   * §5.6: Called BEFORE debit transaction.
   * Rejection = ZERO charge, no ledger entry.
   */
  async moderate(req: ModerationRequest): Promise<ModerationResult> {
    // The user text travels as data in its own message, never interpolated
    // into the instruction, so a prompt cannot rewrite the classifier's task.
    const instruction = 'Classify the generation prompt in the next message for policy violations. Respond with JSON only: { "allowed": boolean, "category": "violence|sexual|hate|illegal|spam|other|none", "confidence": 0-1, "message": "plain language explanation" }';
    const userContent = JSON.stringify({ prompt: req.prompt, negative_prompt: req.negative_prompt ?? null });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1, // Deterministic classification
        max_tokens: 200,
      }),
    });

    // Fail closed: a moderation gate that cannot answer must not allow.
    if (!response.ok) {
      console.error('DeepSeek API error:', response.status);
      return { allowed: false, category: 'other', message: 'moderation unavailable' };
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '';

    try {
      const result = JSON.parse(content);
      return {
        allowed: result.allowed === true,
        category: result.category,
        confidence: result.confidence,
        message: result.message,
      };
    } catch {
      console.error('DeepSeek response not JSON');
      return { allowed: false, category: 'other', message: 'moderation unavailable' };
    }
  }
}
