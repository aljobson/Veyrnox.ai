import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { FilmWorkspace } from '../../_components/film/FilmWorkspace';
export const metadata = { title: 'Film Studio', description: 'Plan a film in seven stages, from your story to consistent, generation-ready shot prompts.', robots: { index: false, follow: false } };
export default function FilmStudioPage() {
  return <div className="min-h-screen bg-vx-base text-vx-fg"><AppNav active="film"/><Main><FilmWorkspace/></Main></div>;
}
