import { MusicSharedSong } from '../../_components/music/MusicSharedSong';

export const metadata = { title: 'Private Music link', robots: { index: false, follow: false } };

export default async function SharedMusicPage({ params }) {
  const { token } = await params;
  return <MusicSharedSong token={token} />;
}
