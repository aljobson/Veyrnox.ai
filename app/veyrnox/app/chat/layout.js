// Metadata for Chat. The page is a client component, so it cannot export it. Behind CHAT_ENABLED and the
// browser preview switch (ADR-0067), so it is kept out of search while it is closed.
export const metadata = {
  title: 'Chat',
  description: 'Chat with leading AI models. Every reply shows its price in Credits before you send, and failed replies are refunded.',
  alternates: { canonical: '/app/chat' },
  robots: { index: false, follow: false },
};

export default function Layout({ children }) {
  return children;
}
