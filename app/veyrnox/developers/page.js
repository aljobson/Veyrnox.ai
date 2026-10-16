import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { CopyButton } from '../_components/CopyButton';
import { Main } from '../_components/Main';

const API = 'https://veyrnox.ai/api/v1/developer';
const OAUTH_METADATA = 'https://veyrnox.ai/.well-known/oauth-protected-resource/api/v1/developer';
const INSTALL = 'pipx install "git+https://github.com/aljobson/Veyrnox.ai.git#subdirectory=agent-harness"';
const DESCRIPTION = 'Build with Veyrnox.ai through the OAuth-secured Developer API and official command-line client.';

export const metadata = {
  title: 'Developers — API and CLI', description: DESCRIPTION,
  alternates: { canonical: '/developers' },
  openGraph: { title: 'Developers — Veyrnox.ai', description: DESCRIPTION, url: '/developers' },
};

const endpoints = [
  ['GET', '/models', 'Models, capabilities and live unit prices.'],
  ['POST', '/estimates', 'Maximum credits before a generation.'],
  ['POST', '/generations', 'Create with an idempotency key and exact price confirmation.'],
  ['GET', '/generations/{id}', 'Poll an owned generation.'],
  ['GET', '/generations/{id}/asset', 'Receive a short-lived asset URL.'],
  ['GET', '/balance', 'Read paid and free credits.'],
];

export default function DevelopersPage() {
  return <div className="min-h-dvh">
    <MarketingNav />
    <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-24">
      <div className="grid lg:grid-cols-[1.08fr_.92fr] gap-14 lg:gap-20 items-start">
        <div>
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Veyrnox for developers</p>
          <h1 className="vx-display vx-title-index mt-5 max-w-[10ch] leading-[.92]">Create media from code.</h1>
          <p className="mt-7 text-lg sm:text-xl text-vx-fg-body max-w-[52ch] leading-[1.55] text-pretty">
            Use the command line or a small OAuth 2.1 API to price, create, track and download Veyrnox generations without copying account secrets.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/api/developer/openapi" className="vx-press rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover">OpenAPI JSON</Link>
            <Link href="/models" className="vx-press rounded-full border border-vx-border px-6 py-3 text-sm font-extrabold text-vx-fg-body hover:border-vx-fg">Browse models</Link>
          </div>
        </div>
        <aside className="rounded-[28px] border border-vx-border bg-vx-panel p-5 sm:p-7" aria-labelledby="install-heading">
          <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] uppercase text-vx-fg-muted">CLI quick start</p>
          <h2 id="install-heading" className="mt-3 text-2xl font-black">Install, sign in, create.</h2>
          {[INSTALL, 'veyrnox auth login', 'veyrnox models list', 'veyrnox generations create --model nano-banana-kie --prompt "A blue fox"'].map((value) =>
            <div key={value} className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-base px-4 py-3">
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{value}</code>
              <CopyButton value={value} label="Copy" copiedLabel="Copied" className="shrink-0" />
            </div>)}
          <p className="mt-5 text-[13px] leading-[1.55] text-vx-fg-muted">Login opens Veyrnox in your browser. Tokens stay in your user-only local config file and can be revoked from Account &amp; security.</p>
        </aside>
      </div>

      <section className="mt-24 sm:mt-32" aria-labelledby="api-heading">
        <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Developer API</p>
        <h2 id="api-heading" className="vx-display mt-4 text-[40px] sm:text-[58px]">Small surface. Real generation.</h2>
        <div className="mt-7 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-panel px-4 py-3 max-w-3xl">
          <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{API}</code>
          <CopyButton value={API} label="Copy" copiedLabel="Copied" className="shrink-0" />
        </div>
        <ul className="mt-10 grid md:grid-cols-2 border-t border-vx-border">
          {endpoints.map(([method, path, body]) => <li key={path} className="border-b border-vx-border py-6 md:pr-8">
            <p><span className="font-vx-mono text-[12px] font-bold text-vx-money">{method}</span> <code className="ml-2 font-vx-mono text-[13px] font-bold">{path}</code></p>
            <p className="mt-2 text-[15px] leading-[1.55] text-vx-fg-body">{body}</p>
          </li>)}
        </ul>
      </section>

      <section className="mt-24 sm:mt-32 grid lg:grid-cols-[.85fr_1.15fr] gap-10 lg:gap-20" aria-labelledby="oauth-heading">
        <div>
          <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">OAuth 2.1 + PKCE</p>
          <h2 id="oauth-heading" className="vx-display mt-4 text-[40px] sm:text-[56px]">Users approve access. Apps keep no secret.</h2>
        </div>
        <div>
          <p className="text-vx-fg-body leading-[1.65]">Start from the protected-resource document. It points to the authorization server’s discovery document, which advertises dynamic client registration, authorization and token endpoints.</p>
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-panel px-4 py-3">
            <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{OAUTH_METADATA}</code>
            <CopyButton value={OAUTH_METADATA} label="Copy" copiedLabel="Copied" className="shrink-0" />
          </div>
          <ol className="mt-7 space-y-4 text-[15px] leading-[1.6] text-vx-fg-body">
            <li><strong className="text-vx-fg">1. Register a public client.</strong> Use an exact redirect URI and <code className="font-vx-mono text-[13px]">token_endpoint_auth_method: none</code>.</li>
            <li><strong className="text-vx-fg">2. Authorize with S256 PKCE.</strong> Send the user to Veyrnox to sign in and approve the connection.</li>
            <li><strong className="text-vx-fg">3. Send the access token.</strong> Use <code className="font-vx-mono text-[13px]">Authorization: Bearer …</code>; rotate and store replacement refresh tokens securely.</li>
          </ol>
        </div>
      </section>

      <section className="mt-24 rounded-[32px] border border-vx-border p-7 sm:p-10 lg:p-14 grid lg:grid-cols-2 gap-10" aria-labelledby="safety-heading">
        <div><p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Spend protection</p>
          <h2 id="safety-heading" className="vx-display mt-4 text-[40px] sm:text-[56px]">Price first. Confirm second.</h2></div>
        <div className="space-y-4 text-vx-fg-body leading-[1.65]">
          <p>Every API generation must include the exact live estimate as <code className="font-vx-mono text-[13px]">confirmed_credits</code>. A changed price returns HTTP 409 before any debit.</p>
          <p>Idempotency keys make safe retries reuse the same generation. Existing ownership checks, account holds, rate limits, moderation, refunds and provider controls remain in force.</p>
          <p className="text-sm text-vx-fg-muted">Use OAuth authorization-code flow with PKCE. Public clients register dynamically and never ship a client secret.</p>
        </div>
      </section>
    </Main>
  </div>;
}
