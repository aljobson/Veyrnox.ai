import { redirect } from 'next/navigation';
import { MusicServerLibrary } from '../../../_components/music/MusicServerLibrary';

export const metadata = { title: 'Music Workspaces' };

export default function MusicWorkspacesPage() {
  const enabled = process.env.MUSIC_UI_ENABLED === 'true'
    && process.env.MUSIC_SCHEMA_ENABLED === 'true'
    && process.env.MUSIC_LIBRARY_ENABLED === 'true';
  if (!enabled) redirect('/app/music/library');
  return <MusicServerLibrary workspaceView collaborationEnabled={process.env.MUSIC_COLLABORATION_ENABLED === 'true'} />;
}
