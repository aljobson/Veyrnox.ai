import { MusicPublicProfile } from '../../../_components/music/MusicPublicProfile';
import { Main } from '../../../_components/Main';
import { getT } from '../../../../../lib/i18n/server';
export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.creator') }; }
export default async function PublicCreatorPage({ params }) { const { handle } = await params; return <Main><MusicPublicProfile handle={handle} /></Main>; }
