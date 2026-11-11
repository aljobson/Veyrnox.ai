import { redirect } from 'next/navigation';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.workspaces') }; }

export default function MusicWorkspacesPage() {
  const enabled = process.env.MUSIC_UI_ENABLED === 'true'
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true';
  if (!enabled) redirect('/app/music/library');
  return <MusicServerLibrary workspaceView collaborationEnabled={process.env.MUSIC_COLLABORATION_ENABLED === 'true'} />;
}
