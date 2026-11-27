import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { projectCoverFor } from '../lib/projectCoverCache';
import type { ProjectCover } from '../lib/projectCover';
import { colors } from '../theme';
import { JobThumb, type AssetLinks } from './JobThumb';

interface Blank { readonly size: number; readonly glyph: string; readonly background?: string }
function Blank({ size, glyph, background }: Blank) {
    return <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.blank, { width: size, height: size }, background ? { backgroundColor: background } : null]}><Text style={styles.glyph}>{glyph}</Text></View>;
}

interface ProjectProps { readonly api: ApiClient; readonly links: AssetLinks; readonly projectId: string; readonly size?: number }
// A saved editor project uses its chosen cover frame and title, falling back to its first visual.
export function ProjectThumb({ api, links, projectId, size = 56 }: ProjectProps) {
    const [cover, setCover] = useState<ProjectCover | null>(null);
    useEffect(() => {
        let live = true;
        void projectCoverFor(api, projectId).then(value => { if (live) setCover(value); });
        return () => { live = false; };
    }, [api, projectId]);
    return <View style={{ width: size, height: size }}>
        {cover?.jobId ? <JobThumb links={links} jobId={cover.jobId} size={size} posterTimeSeconds={cover.posterTimeSeconds} />
            : <Blank size={size} glyph="▤" background={cover?.background} />}
        {cover?.text ? <View pointerEvents="none" style={styles.coverTextWrap}><Text numberOfLines={2} adjustsFontSizeToFit
            style={[styles.coverText, { color: cover.textColor, fontSize: Math.max(8, Math.round(size * .18)) }]}>{cover.text}</Text></View> : null}
    </View>;
}

export interface PostMediaRef { readonly jobId: string | null; readonly mediaType: string }
interface PostProps { readonly links: AssetLinks; readonly media: readonly PostMediaRef[]; readonly size?: number }
// The first attached creation stands for a post; a carousel shows how many follow.
export function PostThumb({ links, media, size = 56 }: PostProps) {
    if (!media.length) return null;
    const first = media.find(item => item.jobId);
    return (
        <View>
            {first?.jobId ? <JobThumb links={links} jobId={first.jobId} size={size} /> : <Blank size={size} glyph={media[0].mediaType === 'video' ? '▶' : '▧'} />}
            {media.length > 1 ? <View style={styles.count}><Text style={styles.countText}>{media.length}</Text></View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    blank: { borderRadius: 8, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    glyph: { color: colors.muted, fontSize: 20 },
    coverTextWrap: { position: 'absolute', inset: 3, justifyContent: 'flex-end' },
    coverText: { fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(0,0,0,.9)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
    count: { position: 'absolute', top: -4, end: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    countText: { color: colors.accentInk, fontSize: 10, fontWeight: '700' },
});
