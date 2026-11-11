import { MusicSongDetail } from '../../../../_components/music/MusicSongDetail';
import { MusicServerSongDetail } from '../../../../_components/music/MusicServerSongDetail';
import { getT } from '../../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.version') }; }

export default async function MusicSongPage({ params }) {
  const { id } = await params;
  const serverLibrary = process.env.MUSIC_UI_ENABLED === 'true'
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true';
  return serverLibrary ? <MusicServerSongDetail id={id} /> : <MusicSongDetail id={id} />;
}
