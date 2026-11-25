import { getT } from '../../../../lib/i18n/server';
import { notFound } from 'next/navigation';
import { editorFeatureEnabled } from '../../../../lib/editorRuntimeFlags.mjs';
export const dynamic = 'force-dynamic';
export async function generateMetadata() {
    const { t } = await getT();
    return { title: t('app.photoStudio.title'), robots: { index: false, follow: false } };
}
export default function PhotoStudioLayout({ children }) {
    if (!editorFeatureEnabled('PHOTO_STUDIO_ENABLED')) notFound();
    return children;
}
