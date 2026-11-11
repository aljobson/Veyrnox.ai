import { MusicLibrary } from '../../../_components/music/MusicLibrary';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';
import { getT } from '../../../../../lib/i18n/server';
import { musicLibraryEnabled, musicSourcesEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.library') }; }

export default function MusicLibraryPage() {
  const serverLibrary = musicUiEnabled() && musicLibraryEnabled();
  const sourcesEnabled = serverLibrary && musicSourcesEnabled();
  return serverLibrary ? <MusicServerLibrary sourcesEnabled={sourcesEnabled} /> : <MusicLibrary />;
}
