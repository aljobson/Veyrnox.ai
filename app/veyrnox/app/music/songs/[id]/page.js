import { MusicSongDetail } from '../../../../_components/music/MusicSongDetail';
import { MusicServerSongDetail } from '../../../../_components/music/MusicServerSongDetail';
import { getT } from '../../../../../../lib/i18n/server';
import { musicLibraryEnabled, musicUiEnabled } from '../../../../../../lib/musicBackend.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.version') }; }

export default async function MusicSongPage({ params }) {
  const { id } = await params;
  // Same gate as the Library page. It reads MUSIC_RUNTIME_FLAGS (the legacy MUSIC_*_ENABLED names are only a
  // fallback inside musicRuntimeFlag), so a deployment that sets the JSON flags still gets the server song page.
  const serverLibrary = musicUiEnabled() && musicLibraryEnabled();
  return serverLibrary ? <MusicServerSongDetail id={id} /> : <MusicSongDetail id={id} />;
}
