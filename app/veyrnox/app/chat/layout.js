import { tOr } from '../../../../lib/i18n/translate.mjs';
import { getT } from '../../../../lib/i18n/server';
// Metadata for Chat. The page is a client component, so it cannot export it. Behind CHAT_ENABLED and the
// browser preview switch (ADR-0067), so it is kept out of search while it is closed.
export async function generateMetadata() {
  const { t } = await getT();
  const title = tOr(t, 'app.meta.chat.title', 'LLM Chat');
  const description = tOr(t, 'app.meta.chat.description', 'Chat with leading AI models. Every reply shows its price in Credits before you send, and failed replies are refunded.');
  return {
    title,
    description,
    alternates: { canonical: '/app/chat' },
    robots: { index: false, follow: false },
  };
}

export default function Layout({ children }) {
  return children;
}
