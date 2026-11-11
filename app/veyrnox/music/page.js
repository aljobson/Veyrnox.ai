import { MusicPublicPrompt } from '../_components/music/MusicPublicPrompt';

export const metadata = {
  title: 'Create original music',
  description: 'Describe an original music direction before signing in, then review an exact private generation quote.',
};

export default function PublicMusicPage() {
  return <MusicPublicPrompt available={process.env.MUSIC_UI_ENABLED === 'true'} />;
}
