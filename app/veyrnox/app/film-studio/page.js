import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { FilmWorkspace } from '../../_components/film/FilmWorkspace';
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.filmStudio.title', 'Film Studio');
  const description = tOr(t, 'app.meta.filmStudio.description', 'Plan a film in seven stages, from your story to consistent, generation-ready shot prompts.');
  return {
    title,
    description,
    robots: { index: false, follow: false },
  };
}
export default function FilmStudioPage() {
  return <div className="min-h-screen bg-vx-base text-vx-fg"><AppNav active="film"/><Main><FilmWorkspace/></Main></div>;
}
