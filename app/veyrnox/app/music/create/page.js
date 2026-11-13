import { MusicCreateStudio } from '../../../_components/music/MusicCreateStudio';
import { getT } from '../../../../../lib/i18n/server';
import { musicSourcesEnabled, musicUiEnabled } from '../../../../../lib/musicBackend.js';
import { getMusicDiscoverSeed, normalizeMusicSampleMix } from '../../../../../lib/musicDiscover.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.createPrivate') }; }

export default async function MusicCreatePage({ searchParams }) {
  const serverMode = musicUiEnabled();
  const sourcesEnabled = serverMode && musicSourcesEnabled();
  const params = await searchParams;
  const rawSample = params?.sample;
  const sampleId = Array.isArray(rawSample) ? rawSample[0] : rawSample;
  const sampleSeed = getMusicDiscoverSeed(sampleId);
  const hasMix = ['tempo', 'drums', 'bass', 'melody'].some((key) => params?.[key] !== undefined);
  const sampleMix = hasMix ? normalizeMusicSampleMix({
    tempo: params?.tempo,
    drums: params?.drums,
    bass: params?.bass,
    melody: params?.melody,
  }) : null;
  return <MusicCreateStudio serverMode={serverMode} sourcesEnabled={sourcesEnabled} sampleSeed={sampleSeed} sampleMix={sampleMix} />;
}
