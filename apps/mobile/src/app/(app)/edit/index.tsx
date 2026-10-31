import { Redirect, useLocalSearchParams } from 'expo-router';

// Quick edit was retired in favour of the Editor. Old links (a result's Edit button, a saved deep link) land here and
// go straight on: with a video, a new Editor project starts with it on the timeline; without one, the Editor home.
export default function RetiredQuickEdit() {
    const { jobId } = useLocalSearchParams<{ jobId?: string }>();
    if (typeof jobId === 'string' && jobId) return <Redirect href={{ pathname: '/editor/new', params: { jobId } }} />;
    return <Redirect href="/editor" />;
}
