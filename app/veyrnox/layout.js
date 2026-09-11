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

export const metadata = {
  title: 'Veyrnox.ai — AI video & image, priced per generation',
  description: 'Credit-metered AI video and image studio. Every generation shows its price before you spend.',
};

export default function VeyrnoxLayout({ children }) {
  return (
    <div className={`${archivo.variable} ${jetbrains.variable} vx-root font-vx bg-vx-base text-vx-fg min-h-dvh`}>
      {children}
    </div>
  );
}
