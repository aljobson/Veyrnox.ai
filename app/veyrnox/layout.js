import localFont from 'next/font/local';
import './veyrnox.css';
import { JobWatcher } from './_components/JobWatcher';
import { AccountBoundary } from './_components/AccountBoundary';
import { PublishFlagProvider } from './_components/PublishFlag';
import { EditorFlagProvider } from './_components/EditorFlag';
import { ProjectsFlagProvider } from './_components/ProjectsFlag';
import { OddlingsPublicFlagProvider } from './_components/OddlingsPublicFlag';
import MascotAssistant from './_components/MascotAssistant';
import { publishEnabled, publishShellAvailable } from '../../lib/social/publishFeature.js';
import { oddlingsPublicEnabled } from './_lib/oddlingsPublicFlag';

// Self-hosted variable fonts (OFL, app/fonts); see app/layout.js.
const archivo = localFont({
  src: '../fonts/archivo-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-archivo',
  display: 'swap',
});

const jetbrains = localFont({
  src: '../fonts/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-jetbrains',
  display: 'swap',
});

// No title/description here: the landing page is the site default, which
// app/layout.js already sets. Restating it would run it through the
// `%s — Veyrnox.ai` template and print the brand twice.

export default function VeyrnoxLayout({ children }) {
  return (
    <div className={`${archivo.variable} ${jetbrains.variable} vx-root font-vx bg-vx-base text-vx-fg min-h-dvh`}>
      <PublishFlagProvider enabled={publishEnabled()} pilot={publishShellAvailable() && !publishEnabled()}>
        <EditorFlagProvider enabled={process.env.EDITOR_TIMELINE_ENABLED === 'true'}>
          <ProjectsFlagProvider enabled={process.env.TENANT_PROJECTS_ENABLED === 'true'}>
            <OddlingsPublicFlagProvider enabled={oddlingsPublicEnabled()}>
              <AccountBoundary>
                {children}
                <JobWatcher />
                <MascotAssistant />
              </AccountBoundary>
            </OddlingsPublicFlagProvider>
          </ProjectsFlagProvider>
        </EditorFlagProvider>
      </PublishFlagProvider>
    </div>
  );
}
