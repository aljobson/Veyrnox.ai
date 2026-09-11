import './globals.css';
import { Inter } from "next/font/google";
import ToasterMount from '../components/ToasterMount';
import AuthGate from '../components/AuthGate.jsx';

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata = {
  title: 'Veyrnox — AI Image & Video Studio',
  description: 'Veyrnox — generate AI images and videos with 200+ models. EU-hosted, C2PA-signed, credit-based.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.variable}>{children}<ToasterMount /><AuthGate /></body>
    </html>
  );
}
