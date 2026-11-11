import { MusicPublicTrack } from '../../../_components/music/MusicPublicTrack';
import { Main } from '../../../_components/Main';
import { getT } from '../../../../../lib/i18n/server';
export async function generateMetadata() { const { t } = await getT(); return { title: t('music.track.eyebrow') }; }
export default async function PublicTrackPage({ params }) { const { slug } = await params; return <Main><MusicPublicTrack slug={slug} /></Main>; }
