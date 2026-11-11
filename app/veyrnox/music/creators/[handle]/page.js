import { MusicPublicProfile } from '../../../_components/music/MusicPublicProfile';
export const metadata = { title: 'Music creator profile' };
export default async function PublicCreatorPage({ params }) { const { handle } = await params; return <MusicPublicProfile handle={handle} />; }
