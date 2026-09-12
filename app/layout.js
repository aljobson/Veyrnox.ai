import './globals.css';
import { Inter } from "next/font/google";
import ToasterMount from '../components/ToasterMount';
import AuthGate from '../components/AuthGate.jsx';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata = {
  title: 'Veyrnox.ai — AI video & image, priced per generation',
  description: 'Credit-metered AI video, image and audio generation. Every generation shows its price before you spend, and failed jobs refund automatically.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.variable}>{children}<ToasterMount /><AuthGate /></body>
    </html>
  );
}
