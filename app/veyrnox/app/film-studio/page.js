import { getT } from '../../../../lib/i18n/server';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { FilmWorkspace } from '../../_components/film/FilmWorkspace';
export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('label.Film Studio'), description: t('app.film.meta.description'), robots: { index: false, follow: false } };
}
export default function FilmStudioPage() {
  return <div className="min-h-screen bg-vx-base text-vx-fg"><AppNav active="film"/><Main><FilmWorkspace/></Main></div>;
}
