import { Archivo, JetBrains_Mono } from 'next/font/google';
import './veyrnox.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
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
    </div>
  );
}
