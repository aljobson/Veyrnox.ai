import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.videoAgent.title', 'Video Agent');
  const description = tOr(t, 'app.meta.videoAgent.description', 'Turn a creative brief into a planned, credit-priced video workflow with Veyrnox.');
  return {
    title,
    description,
    alternates: { canonical: '/app/video-agent' },
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }) {
  return children;
}
