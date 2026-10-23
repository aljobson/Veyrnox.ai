import type { ApiClient } from './api';
import type { Media } from './nativeEditorModel';

interface ProjectAssetRow {
    readonly id: string;
    readonly content_type: string;
    readonly duration_ms?: number | null;
    readonly width?: number | null;
    readonly height?: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listEditorProjectAssets(api: ApiClient, projectId: string): Promise<Media[]> {
    try {
        const result = await api.request<{ assets?: ProjectAssetRow[] }>(`/api/v1/projects/${encodeURIComponent(projectId)}/assets`);
        if (!Array.isArray(result?.assets)) return [];
        return result.assets.flatMap((asset, index) => {
            if (!UUID.test(asset.id)) return [];
            const kind = asset.content_type.startsWith('video/') ? 'video' : asset.content_type.startsWith('image/') ? 'image' : asset.content_type.startsWith('audio/') ? 'audio' : null;
            if (!kind) return [];
            const seconds = typeof asset.duration_ms === 'number' && asset.duration_ms > 0 ? asset.duration_ms / 1000 : kind === 'image' ? 3 : 10;
            return [{
                id: `p-${asset.id}`,
                name: `Project ${kind} ${index + 1}`,
                kind,
                frames: Math.max(1, Math.floor(seconds * 30)),
                hasAudio: kind === 'audio' || kind === 'video',
                width: Math.max(0, Math.round(asset.width ?? 0)),
                height: Math.max(0, Math.round(asset.height ?? 0)),
                assetSource: { projectId, assetId: asset.id },
            } satisfies Media];
        });
    } catch {
        // Project media upload can be closed independently of the editor. Existing timeline media still works.
        return [];
    }
}
