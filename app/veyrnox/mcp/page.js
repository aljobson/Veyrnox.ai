import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { CopyButton } from '../_components/CopyButton';
import { Main } from '../_components/Main';

const ENDPOINT = 'https://veyrnox.ai/api/v1/mcp';
const DESCRIPTION = 'Connect an MCP-compatible assistant to inspect Veyrnox.ai models, credit estimates, generation history and Library assets.';

export const metadata = {
  title: 'MCP connector',
  description: DESCRIPTION,
  alternates: { canonical: '/mcp' },
  openGraph: { title: 'MCP connector — Veyrnox.ai', description: DESCRIPTION, url: '/mcp' },
};

const tools = [
  ['list_models', 'Find current models, controls and unit prices.'],
  ['estimate_generation', 'Calculate the maximum credit charge before anything runs.'],
  ['get_generation', 'Check progress and receive the finished asset link.'],
  ['list_generations', 'Browse recent work from the Veyrnox Library.'],
  ['get_balance', 'Read paid and free credit balances.'],
];

export default function McpPage() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-24">
        <div className="grid lg:grid-cols-[1.15fr_.85fr] gap-14 lg:gap-20 items-start">
          <div>
            <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Veyrnox MCP</p>
            <h1 className="vx-display vx-title-index mt-5 max-w-[11ch] leading-[.92]">
              Make media from your assistant.
            </h1>
            <p className="mt-7 text-lg sm:text-xl text-vx-fg-body max-w-[50ch] leading-[1.55] text-pretty">
              Give an MCP-compatible assistant read-only access to Veyrnox models, exact credit estimates, generation jobs and your finished Library assets.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/app/credits" className="vx-press rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover">
                Check my credits
              </Link>
              <Link href="/models" className="vx-press rounded-full border border-vx-border px-6 py-3 text-sm font-extrabold text-vx-fg-body hover:border-vx-fg">
                Browse models
              </Link>
            </div>
          </div>

          <aside className="rounded-[28px] border border-vx-border bg-vx-panel p-5 sm:p-7" aria-labelledby="connect-heading">
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] uppercase text-vx-fg-muted">Remote endpoint</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-vx-border bg-vx-base px-4 py-3">
              <code className="min-w-0 overflow-x-auto whitespace-nowrap font-vx-mono text-[12px] text-vx-fg-body">{ENDPOINT}</code>
              <CopyButton value={ENDPOINT} label="Copy" copiedLabel="Copied" className="shrink-0" />
            </div>
            <h2 id="connect-heading" className="mt-8 text-2xl font-black">Connect in three steps</h2>
            <ol className="mt-5 space-y-5">
              {[
                ['01', 'Add a custom MCP connector', 'Paste the remote endpoint into your assistant’s MCP or connector settings.'],
                ['02', 'Sign in to Veyrnox', 'Your assistant opens Veyrnox OAuth. Sign in and review the requested connection.'],
                ['03', 'Explore your Veyrnox work', 'Ask about models, costs, recent generations or finished assets. Start anything new in the Veyrnox app.'],
              ].map(([number, title, body]) => (
                <li key={number} className="grid grid-cols-[36px_1fr] gap-3">
                  <span className="font-vx-mono text-[12px] font-bold text-vx-accent pt-1">{number}</span>
                  <div><h3 className="font-extrabold">{title}</h3><p className="mt-1 text-sm leading-[1.55] text-vx-fg-muted">{body}</p></div>
                </li>
              ))}
            </ol>
            <p className="mt-7 border-t border-vx-border pt-5 text-[13px] leading-[1.55] text-vx-fg-muted">
              No Veyrnox API key is pasted into the assistant. Access uses OAuth and stays tied to your account.
            </p>
          </aside>
        </div>

        <section className="mt-24 sm:mt-32" aria-labelledby="tools-heading">
          <div className="max-w-[720px]">
            <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">What it can do</p>
            <h2 id="tools-heading" className="vx-display mt-4 text-[40px] sm:text-[58px]">One connector. Five read-only tools.</h2>
            <p className="mt-4 text-vx-fg-body leading-[1.65]">The connector can inspect your Veyrnox account, but it cannot start a generation, change account data or spend credits.</p>
          </div>
          <ul className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 border-t border-vx-border">
            {tools.map(([name, body]) => (
              <li key={name} className="border-b border-vx-border py-6 md:pr-8">
                <code className="font-vx-mono text-[13px] font-bold text-vx-money">{name}</code>
                <p className="mt-2 text-[15px] leading-[1.55] text-vx-fg-body">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-24 rounded-[32px] border border-vx-border p-7 sm:p-10 lg:p-14 grid lg:grid-cols-2 gap-10" aria-labelledby="spend-heading">
          <div>
            <p className="font-vx-mono text-[12px] font-bold tracking-[0.18em] uppercase text-vx-accent">Read-only by design</p>
            <h2 id="spend-heading" className="vx-display mt-4 text-[40px] sm:text-[56px]">Your assistant cannot charge you.</h2>
          </div>
          <div className="space-y-4 text-vx-fg-body leading-[1.65]">
            <p>The assistant can calculate a live maximum price and help you choose a model, but only the signed-in Veyrnox app can start a generation.</p>
            <p>OAuth tokens are confined to this connector endpoint and cannot be reused against the rest of the Veyrnox API.</p>
            <p className="text-sm text-vx-fg-muted">You can review and revoke every assistant connection from Account &amp; security.</p>
          </div>
        </section>
      </Main>
    </div>
  );
}
