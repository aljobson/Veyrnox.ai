import { notFound } from 'next/navigation';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
import { motionTransferEnabled } from '../../../../lib/motionTransfer.js';
import { MOTION_CLIPS } from '../../../../lib/motionClips.js';
import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import MotionTemplateStudio from '../../_components/MotionTemplateStudio';

export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.motion.title', 'Motion templates');
  const description = tOr(t, 'app.meta.motion.description', 'Pick a movement and the person or pet in your photo performs it.');
  return { title, description, robots: { index: false, follow: false } };
}

// Flags are read per request, so flipping one needs no rebuild (ADR-0269).
export const dynamic = 'force-dynamic';

export default function MotionTemplatesPage() {
  const modes = { move: motionTransferEnabled(process.env, 'move'), replace: motionTransferEnabled(process.env, 'replace') };
  if (!modes.move && !modes.replace) notFound();
  // Only ids reach the client; the clips' R2 keys stay on the server.
  const readyIds = MOTION_CLIPS.filter(c => c.ready).map(c => c.id);
  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="features" />
      <Main className="mx-auto max-w-[1320px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        <MotionTemplateStudio modes={modes} readyIds={readyIds} />
      </Main>
    </div>
  );
}
