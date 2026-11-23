export const REACTIONS = ['fire', 'love', 'wow', 'praise', 'like', 'cool', 'hot'] as const;
export type Reaction = typeof REACTIONS[number];
export const REPORT_CATEGORIES = ['spam', 'abuse', 'privacy', 'rights', 'other'] as const;
export type ReportCategory = typeof REPORT_CATEGORIES[number];
export const GENRES = ['pop', 'hip-hop', 'rock', 'electronic', 'house', 'lo-fi', 'jazz', 'rnb-soul', 'ambient', 'cinematic', 'country-folk', 'latin'] as const;
export type Creator = { creator_id: string; handle: string; display_name?: string };
export type RailTrack = Creator & { slug: string; title: string };
export type CommercialStatus = 'personal_use_only' | 'plan_eligible_terms_apply';
export type PublicTrack = Creator & { title: string; version_number: number; published_at: string;
    allow_comments: boolean; allow_remixes: boolean; commercial_status: CommercialStatus; audio_url: string };
export type Counts = { reactions: Record<Reaction, number>; follower_count: number };
export type Social = Counts & { my_reaction: Reaction | null; following: boolean; is_own: boolean };
export type ApprovedComment = { id: string; author_id: string; parent_id: string | null; body: string;
    at_seconds: number | null; created_at: string; author: string; is_creator: boolean; own: boolean };
export type OwnComment = Pick<ApprovedComment, 'id' | 'parent_id' | 'body' | 'created_at'> & { status: 'pending' | 'rejected' };
export type Comments = { allow_comments: boolean; comments: ApprovedComment[]; next_cursor: string | null; own_comments: OwnComment[] };
export type TrackPage = { track: PublicTrack; lyrics?: string; plays?: { count: number }; reports?: { open: true };
    social?: Counts; comments?: Comments; rails?: { by_creator: RailTrack[]; similar: RailTrack[] } };
export type ProfilePage = { profile: Creator; tracks: { slug: string; title: string; published_at: string;
    commercial_status: CommercialStatus; creator_id: string }[]; albums?: PublicAlbum[]; social?: Counts };
export type PublicAlbum = { id: string; slug: string; title: string; album_type: 'album' | 'ep' | 'single'; description: string; has_artwork: boolean; artwork_url?: string; published_at: string;
    creator_id: string; handle: string; display_name?: string; tracks: { publication_id: string; slug: string; title: string; position: number }[] };
export type BestOf = { playlists: { genre: typeof GENRES[number]; tracks: RailTrack[] }[] };
export type Blocked = { blocked: { creator_id: string; display_name: string } };
export type BlockRow = { actor_id: string; display_name: string; created_at: string };
export type BlockReceipt = { actor_id: string; blocked: boolean; already: boolean };
export type PublicRead<T> = { state: 'on'; data: T } | { state: 'gone' } | { state: 'off' };
export type PublicWrite =
    | { kind: 'reaction'; slug: string; reaction: Reaction | null }
    | { kind: 'follow'; handle: string; following: boolean }
    | { kind: 'submit'; slug: string; body: string; at_seconds?: number; parent_id?: string }
    | { kind: 'withdraw'; comment_id: string }
    | { kind: 'report'; comment_id: string; category: ReportCategory; details: string }
    | { kind: 'report_song'; slug: string; category: ReportCategory; details: string };
export type CommentReceipt = { id: string; status: 'pending' | 'withdrawn' | 'reported'; idempotent: boolean };
export type WriteReceipt = CommentReceipt | { status: 'reported'; idempotent?: boolean } | { social: Social; idempotent: boolean };

export const creatorName = (creator: Creator) => creator.display_name?.trim() || creator.handle;
