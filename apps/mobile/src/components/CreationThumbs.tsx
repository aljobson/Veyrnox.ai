import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { projectCoverFor } from '../lib/projectCoverCache';
import { colors } from '../theme';
import { JobThumb, type AssetLinks } from './JobThumb';

interface Blank { readonly size: number; readonly glyph: string }
function Blank({ size, glyph }: Blank) {
    return <View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.blank, { width: size, height: size }]}><Text style={styles.glyph}>{glyph}</Text></View>;
}

interface ProjectProps { readonly api: ApiClient; readonly links: AssetLinks; readonly projectId: string; readonly size?: number }
// A saved editor project stands for itself with the first picture or clip on its timeline.
export function ProjectThumb({ api, links, projectId, size = 56 }: ProjectProps) {
    const [jobId, setJobId] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        void projectCoverFor(api, projectId).then(id => { if (live) setJobId(id); });
        return () => { live = false; };
    }, [api, projectId]);
    return jobId ? <JobThumb links={links} jobId={jobId} size={size} /> : <Blank size={size} glyph="▤" />;
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
    count: { position: 'absolute', top: -4, end: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
    countText: { color: colors.accentInk, fontSize: 10, fontWeight: '700' },
});
