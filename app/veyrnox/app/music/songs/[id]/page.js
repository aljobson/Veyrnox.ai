import { MusicSongDetail } from '../../../../_components/music/MusicSongDetail';
import { MusicServerSongDetail } from '../../../../_components/music/MusicServerSongDetail';

export const metadata = { title: 'Music version' };

export default async function MusicSongPage({ params }) {
  const { id } = await params;
  const serverLibrary = process.env.MUSIC_UI_ENABLED === 'true'
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true';
  return serverLibrary ? <MusicServerSongDetail id={id} /> : <MusicSongDetail id={id} />;
}
