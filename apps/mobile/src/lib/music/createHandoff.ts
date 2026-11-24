import { DISCOVER_SEEDS, buildSamplePrompt } from './discoverSeeds';
import { isCurrentMusicDailyChallenge } from './dailyChallenge';
import type { MusicEntitlements, MusicInputSnapshot } from './types';

type Input = Pick<MusicInputSnapshot, 'mode' | 'prompt' | 'title' | 'lyrics' | 'styles'>;
type Translate = (key: string) => string;

/** Pure handoff resolver used by Create after entitlements arrive. It never quotes or submits. */
export function resolveMusicCreateHandoff(options: {
    sampleId?: string;
    challengeId?: string;
    entitlements: MusicEntitlements | null;
    input: Input;
    rights: boolean;
    touched: boolean;
    pending: boolean;
    translate: Translate;
    now?: number;
}): { prompt: string; title: string } | null {
    const sample = DISCOVER_SEEDS.find(seed => seed.id === options.sampleId);
    if (!sample && !options.challengeId) return null;
    const input = options.input;
    if (options.touched || options.pending || input.mode !== 'simple' || input.prompt || input.title
        || input.lyrics || input.styles || options.rights) return null;
    if (sample) return { prompt: buildSamplePrompt(sample), title: sample.title };
    const daily = options.entitlements?.features.dailyChallenge ? options.entitlements.daily_challenge : undefined;
    if (!daily || daily.id !== options.challengeId || !isCurrentMusicDailyChallenge(daily, options.now)) return null;
    return { prompt: options.translate(daily.prompt_key), title: options.translate(daily.title_key) };
}
