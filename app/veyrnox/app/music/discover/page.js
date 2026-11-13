import { MusicDiscover } from '../../../_components/music/MusicDiscover';
import { getT } from '../../../../../lib/i18n/server';
import { getMusicDiscoverSeed, normalizeMusicSampleMix } from '../../../../../lib/musicDiscover.js';
import { isMusicSavedMixId } from '../../../_lib/music/savedMixes.js';

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: t('music.meta.discover'),
    description: t('music.meta.discoverDescription'),
  };
}

export default async function MusicDiscoverPage({ searchParams }) {
  const params = await searchParams;
  const rawSample = Array.isArray(params?.sample) ? params.sample[0] : params?.sample;
  const initialSample = getMusicDiscoverSeed(rawSample);
  const hasMix = initialSample && ['tempo', 'drums', 'bass', 'melody'].some((key) => params?.[key] !== undefined);
  const initialMix = hasMix ? normalizeMusicSampleMix({
    tempo: params?.tempo,
    drums: params?.drums,
    bass: params?.bass,
    melody: params?.melody,
  }) : null;
  const rawSavedMixId = Array.isArray(params?.savedMix) ? params.savedMix[0] : params?.savedMix;
  const rawMixName = Array.isArray(params?.mixName) ? params.mixName[0] : params?.mixName;
  const initialSavedMixId = initialSample && isMusicSavedMixId(rawSavedMixId) ? rawSavedMixId : '';
  const initialMixName = initialSavedMixId && typeof rawMixName === 'string' ? rawMixName.slice(0, 64) : '';
  return <MusicDiscover initialSample={initialSample} initialMix={initialMix} initialSavedMixId={initialSavedMixId} initialMixName={initialMixName} />;
}
