import { MusicLibrary } from '../../../_components/music/MusicLibrary';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.library') }; }

export default function MusicLibraryPage() {
  const serverLibrary = process.env.MUSIC_UI_ENABLED === 'true'
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true';
  const sourcesEnabled = serverLibrary && process.env.MUSIC_SOURCES_ENABLED === 'true';
  return serverLibrary ? <MusicServerLibrary sourcesEnabled={sourcesEnabled} /> : <MusicLibrary />;
}
