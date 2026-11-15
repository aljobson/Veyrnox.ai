import { notFound } from 'next/navigation';
import { musicBeatEditorEnabled } from '../../../../../lib/musicBackend.js';
import { BeatsHomeLoader } from '../../../_components/music/beat/BeatsHomeLoader';

export function generateMetadata() { return { title: 'Beats' }; }
export default function BeatsPage() {
  if (!musicBeatEditorEnabled()) notFound();
  return <BeatsHomeLoader />;
}
