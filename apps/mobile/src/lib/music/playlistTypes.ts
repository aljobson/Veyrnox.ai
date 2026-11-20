export type PlaylistSong = Readonly<{
    id: string; title: string; version_id: string; audio_url: string; position: number;
}>;
export type Playlist = Readonly<{
    id: string; title: string; pinned: boolean; revision: number; created_at?: string;
    songs: readonly PlaylistSong[];
}>;
export type PlaylistReceipt = Readonly<{ revision: number; idempotent: boolean }>;
export type PlaylistEdit = Readonly<{ action: 'replace'; expected_revision: number; song_ids: readonly string[] }>
    | Readonly<{ action: 'pin'; expected_revision: number; pinned: boolean }>;
export type PlaylistWrite = Readonly<{ kind: 'create'; title: string }>
    | Readonly<{ kind: 'patch'; id: string; edit: PlaylistEdit }>;
