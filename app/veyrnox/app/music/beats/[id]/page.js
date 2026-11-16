import { notFound } from 'next/navigation';
import { musicBeatAiEnabled, musicStemsEnabled, musicTargetStemsEnabled, musicExtendEnabled, musicReplaceEnabled, musicBeatLibrarySaveEnabled, musicBeatCloudEnabled, musicBeatEditorEnabled, musicMagicBarEnabled } from '../../../../../../lib/musicBackend.js';
import { BeatEditorLoader } from '../../../../_components/music/beat/BeatEditorLoader';

export function generateMetadata() { return { title: 'Beat editor' }; }
export default async function BeatPage({ params }) {
  if (!musicBeatEditorEnabled()) notFound();
  const { id } = await params;
  const enabled = musicBeatAiEnabled();
  const ai = { generate: enabled, stems: enabled && musicStemsEnabled(), targetStems: enabled && musicTargetStemsEnabled(), extend: enabled && musicExtendEnabled(), replace: enabled && musicReplaceEnabled() };
  return <BeatEditorLoader ai={ai} librarySave={musicBeatLibrarySaveEnabled()} cloud={musicBeatCloudEnabled()} id={id} magicBar={musicMagicBarEnabled()} />;
}
