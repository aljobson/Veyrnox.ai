import { permanentRedirect } from 'next/navigation';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.workspaces') }; }

export default function MusicWorkspacesPage() {
  permanentRedirect('/app/music/library');
}
