import { MusicCreateStudio } from '../../../_components/music/MusicCreateStudio';
import { getT } from '../../../../../lib/i18n/server';
import { musicSourcesEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';
import { getMusicDiscoverSeed } from '../../../../../lib/musicDiscover.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.createPrivate') }; }

export default async function MusicCreatePage({ searchParams }) {
  const serverMode = musicUiEnabled();
  const sourcesEnabled = serverMode && musicSourcesEnabled();
  const rawSample = (await searchParams)?.sample;
  const sampleId = Array.isArray(rawSample) ? rawSample[0] : rawSample;
  const sampleSeed = getMusicDiscoverSeed(sampleId);
  return <MusicCreateStudio serverMode={serverMode} sourcesEnabled={sourcesEnabled} sampleSeed={sampleSeed} />;
}
