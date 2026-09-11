import { Archivo, JetBrains_Mono } from 'next/font/google';
import './muon.css';

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
  title: 'Muon — AI video & image, priced per generation',
  description: 'Credit-metered AI video and image studio. Every generation shows its price before you spend.',
};

export default function MuonLayout({ children }) {
  return (
    <div className={`${archivo.variable} ${jetbrains.variable} muon-root font-muon bg-muon-base text-muon-fg min-h-dvh`}>
      {children}
    </div>
  );
}
