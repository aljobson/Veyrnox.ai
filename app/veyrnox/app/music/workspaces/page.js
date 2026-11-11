import { redirect } from 'next/navigation';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';
import { getT } from '../../../../../lib/i18n/server';
import { musicLibraryEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';
import { musicCollaborationEnabled } from '../../../../../lib/musicCollaboration.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.workspaces') }; }

export default function MusicWorkspacesPage() {
  const enabled = musicUiEnabled() && musicLibraryEnabled();
  if (!enabled) redirect('/app/music/library');
  return <MusicServerLibrary workspaceView collaborationEnabled={musicCollaborationEnabled()} />;
}
