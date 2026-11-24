export type AlbumTrack = Readonly<{ publication_id: string; slug: string; title: string; position: number; audio_url?: string }>;
export type AlbumType = 'album' | 'ep' | 'single';
export type AlbumArtwork = Readonly<{ asset_id: string; job_id: string; created_at: string; image_url: string }>;
export type AlbumTrackOption = Readonly<{ publication_id: string; song_id: string; slug: string; title: string }>;
export type Album = Readonly<{ id: string; title: string; album_type: AlbumType; artwork_asset_id: string | null; description: string; has_artwork: boolean; slug: string | null;
    status: 'draft' | 'published' | 'unpublished' | 'blocked'; revision: number; published_at: string | null; tracks: readonly AlbumTrack[] }>;
export type PublicAlbum = Readonly<{ id: string; slug: string; title: string; album_type: AlbumType; description: string; has_artwork: boolean;
    artwork_url?: string; handle: string; display_name?: string; creator_id: string; published_at: string; tracks: readonly AlbumTrack[] }>;
export type AlbumPatch = Readonly<{ action: 'update'; expected_revision: number; title: string; album_type: AlbumType; description: string; artwork_asset_id: string | null }>
    | Readonly<{ action: 'replace'; expected_revision: number; publication_ids: readonly string[] }>
    | Readonly<{ action: 'publish' | 'unpublish' | 'delete'; expected_revision: number }>;
