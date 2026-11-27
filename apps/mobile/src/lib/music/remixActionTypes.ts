import type { PairQuote, GenerationActionStart } from './generationActionTypes';

export type RemixActionKind = 'mashup' | 'sample';

export type MusicRemixQuote = PairQuote & Readonly<{
    kind: RemixActionKind;
}>;

export type MusicRemixStart = GenerationActionStart;

export type MashupParameters = Readonly<{
    prompt: string;
    second_song_id: string;
    second_version_id: string;
    source_influence: number;
}>;

export type SampleParameters = Readonly<{
    prompt: string;
    start_seconds: number;
    end_seconds: number;
    extend_seconds: number;
}>;

export type RemixParameters = MashupParameters | SampleParameters;

export type MusicRemixQuoteRequest =
    | Readonly<{ kind: 'mashup'; version_id: string; second_song_id: string; second_version_id: string;
        prompt: string; source_influence: number; rights_confirmed: true }>
    | Readonly<{ kind: 'sample'; version_id: string; start_seconds: number; end_seconds: number;
        extend_seconds: number; prompt: string; rights_confirmed: true }>;
