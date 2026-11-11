import { MusicStudioWorkspace } from '../../../../_components/music/MusicStudioWorkspace';

export const metadata = { title: 'Studio workspace' };

export default async function MusicStudioSongPage({ params }) {
  const { id } = await params;
  return <MusicStudioWorkspace id={id} />;
}
