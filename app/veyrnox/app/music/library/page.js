import { MusicLibrary } from '../../../_components/music/MusicLibrary';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';
import { musicLibraryTabsEnabled } from '../../../../../lib/musicLibraryTabs.js';
import { getT } from '../../../../../lib/i18n/server';
import { musicBeatEditorEnabled, musicLibraryEnabled, musicSourcesEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';
import { musicCollaborationEnabled } from '../../../../../lib/musicCollaboration.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.library') }; }

export default function MusicLibraryPage() {
  const serverLibrary = musicUiEnabled() && musicLibraryEnabled();
  const sourcesEnabled = serverLibrary && musicSourcesEnabled();
  return serverLibrary ? <MusicServerLibrary sourcesEnabled={sourcesEnabled} collaborationEnabled={musicCollaborationEnabled()} tabsEnabled={musicLibraryTabsEnabled()} beatEditor={musicBeatEditorEnabled()} /> : <MusicLibrary />;
}
