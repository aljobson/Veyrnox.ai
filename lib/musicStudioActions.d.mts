export type MusicStudioOperation =
  | { readonly type: 'set_tempo'; readonly bpm: number }
  | { readonly type: 'set_track_mute'; readonly trackId: string; readonly value: boolean }
  | { readonly type: 'set_track_solo'; readonly trackId: string; readonly value: boolean }
  | { readonly type: 'set_view'; readonly view: 'song' | 'pattern' }
  | { readonly type: 'select_pattern'; readonly pattern: 'A' | 'B' | 'C' | 'D' };
export type MusicStudioResult = Readonly<{
  kind: 'answer' | 'error' | 'blocked'; code: string; messageKey: string; params: Readonly<Record<string, string | number>>;
  tracks?: readonly Readonly<{ index: number; name: string; mute: boolean; solo: boolean }>[];
}> | Readonly<{
  kind: 'proposal'; code: string; messageKey: string; params: Readonly<Record<string, string | number>>;
  operation: MusicStudioOperation; revision: Readonly<{ id: string; updatedAt: number; document: object }>;
}>;
export const MUSIC_STUDIO_INPUT_LIMIT: number;
export const MUSIC_STUDIO_ACTION_TYPES: readonly MusicStudioOperation['type'][];
export function planMusicStudioAction(input: {
  input: string;
  document: unknown;
  capabilities: { studioChat?: boolean; magicBar?: boolean };
  editability?: { readOnly?: boolean; replacing?: boolean; busy?: boolean; recording?: boolean };
}): MusicStudioResult;
export function musicStudioProposalCurrent(result: MusicStudioResult | null, document: unknown): boolean;
