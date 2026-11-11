import { MusicPreviewShell } from '../../_components/music/MusicPreviewShell';
import { cookies } from 'next/headers';
import { MUSIC_PREVIEW_FLAG } from '../../_lib/music/previewStore';
import { getT } from '../../../../lib/i18n/server';
import {
  musicLibraryEnabled, musicPlaylistsEnabled, musicStudioEnabled, musicUiEnabled,
} from '../../../../lib/musicBackend.js';

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: { default: t('music.meta.preview'), template: t('music.meta.template') },
    description: t('music.meta.previewDescription'),
    robots: { index: false, follow: false },
  };
}

export default async function MusicLayout({ children }) {
  const serverMode = musicUiEnabled();
  const libraryMode = serverMode && musicLibraryEnabled();
  const playlistsMode = libraryMode && musicPlaylistsEnabled();
  const studioMode = libraryMode && musicStudioEnabled();
  const initialEnabled = serverMode || (process.env.NODE_ENV === 'development'
    && (await cookies()).get(MUSIC_PREVIEW_FLAG)?.value === '1');
  return <MusicPreviewShell initialEnabled={initialEnabled} serverMode={serverMode} libraryMode={libraryMode} playlistsMode={playlistsMode} studioMode={studioMode}>{children}</MusicPreviewShell>;
}
