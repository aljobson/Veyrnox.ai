import localFont from 'next/font/local';
import './veyrnox.css';
import { JobWatcher } from './_components/JobWatcher';

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
      {children}
      <JobWatcher />
    </div>
  );
}
