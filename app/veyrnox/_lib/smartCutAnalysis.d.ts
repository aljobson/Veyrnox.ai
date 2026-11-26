export type CanonicalSmartCutInput = {
  readonly clips?: readonly unknown[];
  readonly analyses?: ReadonlyMap<string, unknown> | readonly unknown[] | Readonly<Record<string, unknown>>;
  readonly script?: string;
  readonly notes?: string;
  readonly languageOverride?: string;
  readonly silencePreset?: string;
  readonly minimumSilenceSeconds?: number;
  readonly edgePaddingSeconds?: number;
  readonly removals?: readonly unknown[];
};

export declare const SPEECH_CUT_LANGUAGES: readonly string[];

export declare function buildSpeechAwareCutPlan(input?: CanonicalSmartCutInput): unknown;
export declare function swapSpeechAwareCutTake(plan: unknown, segmentId: string, takeId: string): unknown;
