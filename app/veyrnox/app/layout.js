// ADR-0060: framework scripts must use this request's nonce, never cached HTML.
export const dynamic = 'force-dynamic';

// Metadata for /app (Explore). Child routes — create, library, credits,
// admin — override the title from their own layouts.
export const metadata = {
  // A plain string here would swallow the root template and leave every
  // child route with a bare, brandless title.
  // `default` is still run through the parent template, so it carries no
  // brand of its own; `template` is what child routes inherit.
  title: { default: 'Explore', template: '%s — Veyrnox.ai' },
  description:
    'Browse curated presets pinned to their best-fit model, each priced up front. Open one to generate on your credit balance.',
  alternates: { canonical: '/app' },
};

export default function Layout({ children }) {
  return children;
}
