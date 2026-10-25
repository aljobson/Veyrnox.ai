import { notFound } from 'next/navigation';
import CreativeFeatureStudio from '../../../_components/CreativeFeatureStudio';
import VoiceCloneStudio from '../../../_components/VoiceCloneStudio';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { CREATIVE_FEATURE_SLUGS, creativeFeature } from '../../../_lib/creativeFeatures';

export function generateStaticParams() {
  return CREATIVE_FEATURE_SLUGS.map((slug) => ({ slug }));
}

export default async function CreativeFeaturePage({ params }) {
  const { slug } = await params;
  const feature = creativeFeature(slug);
  if (!feature) notFound();
  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="features" />
      <Main className="mx-auto max-w-[1320px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        {slug === 'ai-voice-cloning' ? <VoiceCloneStudio /> : <CreativeFeatureStudio feature={feature} />}
      </Main>
    </div>
  );
}
