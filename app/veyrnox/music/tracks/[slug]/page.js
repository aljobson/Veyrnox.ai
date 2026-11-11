import { MusicPublicTrack } from '../../../_components/music/MusicPublicTrack';
export const metadata = { title: 'Public Music track' };
export default async function PublicTrackPage({ params }) { const { slug } = await params; return <MusicPublicTrack slug={slug} />; }
