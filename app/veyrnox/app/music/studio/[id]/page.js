import { MusicStudioWorkspace } from '../../../../_components/music/MusicStudioWorkspace';
import { getT } from '../../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.studio') }; }

export default async function MusicStudioSongPage({ params }) {
  const { id } = await params;
  return <MusicStudioWorkspace id={id} />;
}
