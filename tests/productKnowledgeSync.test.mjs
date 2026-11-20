import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AUTO_PRODUCT_DOCS, AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';
import { buildVeyKnowledgeArtifact, renderVeyKnowledgeModule } from '../scripts/lib/vey-knowledge-source.mjs';

const root = process.cwd();
const retiredFilmStudioKnowledge = {
    controls: new Set(['Import studio JSON', 'Prepare 16:9 master']),
    links: new Set(['/legal/aup']),
    descriptions: new Set([
        'Your current film is still here. Export it first if you want to keep a separate copy.',
        'The studio export contains your project documents and this folder structure.',
        'Create an exact 16:9 master at 1920×1080. The picture fills the frame with a centre crop, without stretching. The shot card sets the length. Export is free. Masters prepared from a Library take can be saved directly to your Library.',
        'To save directly to Library, log a Library take ID and prepare its master without choosing a local file.',
        'Saving is free. The video stays in your Library until its source take expires, up to 90 days.',
    ]),
};
const retiredOddlingsKnowledge = {
    descriptions: new Set([
        'Local moodboard preview; describe what to borrow below.',
    ]),
};
// The chat settings sidebar was folded into the message box: Thinking, Web search, Deep research and image
// attachment are controls in its setup row, which simply hides an option a model does not offer.
const retiredChatKnowledge = {
    controls: new Set(['Capabilities', 'Tools']),
    descriptions: new Set(['This model does not offer Thinking.', 'This model cannot read images.', 'This model does not offer Web search.']),
};
// The source-rights tick on Create was removed: the statement now lives in the Terms of Service and
// Acceptable Use Policy, so its help line, its Acceptable Use link and its assistant target are retired.
const retiredCreateKnowledge = {
    descriptions: new Set(['This confirmation applies only to this tab and these sources. Replacing a source or opening another draft requires a new confirmation.']),
    links: new Set(['/legal/aup']),
    targets: new Set(['create.consent']),
};
// The same move retired the Editor panel's Acceptable Use link, and the Terms and Acceptable Use Policy
// paragraphs that described asking for the tick now say the statement is made by attaching a file.
// Project JSON save/open controls were removed from the editor (JSON is too technical for users).
const retiredEditorKnowledge = { links: new Set(['/legal/aup']), controls: new Set(['Download project file','Files Project files','Choose project JSON file','Local project files']), descriptions: new Set(['Opening project file…','Timestamped VTT and enhanced LRC retain word timing. JSON accepts word/start/end in seconds. ASS retains text and cue timing; its style tags use your editor style.','Detach from the cloud project before opening a local project file.','Project files contain your edits and media details. Keep the original media and font files; reopening may require relinking them.']) };
const retiredLegalKnowledge = {
    '/legal/aup': new Set(['Before you upload a photo, a video or a recording of a voice, you must either own it or have the permission of everyone identifiable in it. When a generation takes an upload, we ask you to confirm that, and we record the confirmation against that job. Confirming it falsely is a breach of these terms.']),
    '/legal/terms': new Set(['You keep whatever rights you hold in the prompts and reference files you upload. You grant us a licence to process them solely to run the service.']),
};
// 17 November 2026: the legal pages stopped naming suppliers, hosting layers and regions and dropped system-internals detail.
// These are the English paragraphs and headings they replaced or removed; the remaining wording is pinned by legalTranslation.test.mjs.
const retiredSupplierDisclosure = [
    "Optional session replay",
    "if you separately consent, a privacy-masked reconstruction of up to 100% of eligible browser sessions. All text and inputs are masked; images, video, audio, canvas and iframes are blocked; console output, request or response bodies and headers are not recorded; and replay is disabled on sign-in, account, admin and payment pages.",
    "credit packs are sold through Stripe Managed Payments, under which Stripe, Inc. is the Merchant of Record and seller of record, and charges and remits any VAT or sales tax. Stripe collects your payment details, billing address and any tax information as its own controller, under its own privacy policy. We receive the payment reference, amount, currency, country and email so we can add the credits to your account. We never see or store full card numbers.",
    "Where your data lives",
    "We run on Supabase for the database and authentication, and on Cloudflare for edge hosting and object storage. Account data, credit ledger, generation metadata and your chat conversations sit in our Supabase database, which is hosted in the European Union (Frankfurt, Germany). Generated media is stored in the European Union, in Cloudflare R2 with an EU jurisdictional restriction. If you consent to optional analytics, analytics, masked replay and error events are processed in PostHog Cloud EU. Your prompts, chat messages and reference files or images are transmitted to the third-party model provider that runs the model you selected, through our model gateway, for the sole purpose of producing your output. For chat we ask the gateway to use only providers that do not store your content or use it to train models. If you switch on Web search, your question is also sent to a web search provider. When Web search runs through our own search, that provider is Exa (exa.ai) or Parallel (parallel.ai), depending on the service configuration. It receives your question as the search query; Parallel also receives a chat conversation identifier and the selected model identifier, and the text of the pages it finds is sent, through our model gateway, to the model provider along with your question so the answer can cite sources.",
    "Some of the companies that process your personal data are outside the United Kingdom and the EEA: our edge hosting, the model providers, and Stripe, Inc. (United States), which is the Merchant of Record for credit pack purchases. Where your personal data is processed outside the United Kingdom or the EEA, we rely on the UK International Data Transfer Agreement or the EU Standard Contractual Clauses with the company concerned. If we move the database to another region we will update this page before the move takes effect.",
    "We store the connected channel details, granted permissions, posting history and analytics in our Supabase database. Access and refresh tokens are encrypted before storage and used by our server to make the authorized YouTube API calls, including scheduled uploads. Selecting a Library video does not by itself upload it to YouTube. When you post or schedule it, we send the selected video and its title and description to YouTube.",
    "Disconnecting a channel removes its stored access and refresh tokens and stops further publishing and analytics collection for that connection. It does not delete videos already uploaded to YouTube. Account details, posting history and previously collected analytics remain part of your Veyrnox.ai account; you can request their deletion using the contact and data-rights process below. You can also revoke Veyrnox.ai Publish’s access through your Google Account.",
    "How we protect your data",
    "We use the following safeguards to protect personal data, including sensitive Google user data obtained through the YouTube API, against unauthorized access and disclosure:",
    "Encryption in transit",
    "we use HTTPS/TLS to encrypt data sent between your browser and Veyrnox.ai, and between our servers and Google’s APIs and our database.",
    "Protection of stored OAuth tokens",
    "YouTube access and refresh tokens are encrypted with AES-256-GCM before they are stored in our database. The encryption key is held separately in a server-side secret. Tokens are used by our servers for the features you authorize and are not returned to the browser in connected-account responses.",
    "Access controls",
    "our APIs verify your signed-in identity and check that the connected accounts and associated data belong to you. Connected-account and analytics tables use database row-level security, with access through controlled server-side operations rather than direct browser access.",
    "Planned model processor: BytePlus",
    "BytePlus Pte. Ltd. (Singapore) is a planned processor for selected Seedance video models. These models are not currently available on Veyrnox.ai. When enabled, choosing one of these models will send your prompt and any reference images to BytePlus ModelArk in Singapore to generate your video. This processing takes place outside the United Kingdom and the EEA; storing the finished video in our EU storage does not keep the generation processing within those regions.",
    "We will enable these models only after the applicable data-processing and international-transfer arrangements are in place. We will update this notice when the models become available.",
    "Completed Publish uploads stay in your Publish uploads until removed. A file used by a draft, scheduled or in-progress post cannot be removed until that post finishes or is canceled; its metadata remains in the posting history. Abandoned uploads are deleted after 24 hours. Removing an unused file queues its storage deletion after its upload link expires, normally within 20 minutes.",
    "Chat conversations are kept until you delete them. Deleting a chat removes it and its messages from our database straight away.",
    "Our database is backed up daily and each backup is kept for around seven days, so a chat you delete can remain in a backup for up to that long before it expires.",
    "Images you upload to a chat are kept in our storage only long enough to answer, and are deleted within 24 hours. An image you pick from your Library for a chat stays in your Library, and is sent to the model provider to answer. If you choose a video, your browser takes a few still frames from it and those are attached as images; the video itself is not uploaded.",
    "Ledger records are kept for as long as your account exists plus the period required by tax law. A chat reply’s entry in your credit history records which model, which options and the Credits charged; it never contains the text of your messages.",
    "Request logs are kept for a short security window and then discarded.",
    "Optional product analytics and error events are kept for up to 12 months. Optional session replays are kept for up to 30 days. Withdrawing consent stops new collection; you can also ask us to delete existing events linked to your account.",
    "You can delete your account yourself from Account & security. Deleting it signs you out everywhere and erases your sign-in, your chats, personas and folders, your generated files and the prompts behind them, your Publish connections and their stored access tokens, and your referral code. Credits you have not used are forfeited and nothing is refunded; the screen tells you how many before you confirm. We cannot delete an account while a payment dispute or a content hold is open, while a subscription is active, or while a generation is still running; the screen says which applies.",
    "To stop deleting and re-registering from restoring the free sign-up Credits, we keep a one-way hash of your email address after you delete. We hold it only for fraud prevention, on the basis of our legitimate interest, and use it for nothing else. Nothing is posted to or removed from networks you published to: revoke Veyrnox.ai’s access in each network’s own settings.",
    "Sharing",
    "We share data only with the companies needed to run the service: authentication and database hosting, edge hosting and storage, PostHog for optional consented analytics and diagnostics, AI model providers and the model gateway that routes requests to them, web search providers when you switch on Web search (Exa or Parallel, when it runs through our own search), Resend for the emails we send about your account, and Stripe, Inc. for credit pack purchases. Stripe, Inc. acts as its own controller for the purchase it makes as Merchant of Record. When you schedule a Publish post, we send its media and caption to the social networks you select. Uploading a file alone does not send it to a social network. We do not sell personal data. Sentry processes the necessary server error reports described above.",
    "We also use Sentry for necessary server-side error reporting, independently of your optional analytics choice. To diagnose failures and protect the service, reports include error types, code locations and sanitized route paths. Reports are configured to exclude prompts, chat text, media, passwords, payment details, request bodies, headers, cookies and signed link tokens. This is not browser analytics or session replay.",
    "We use cookies and local storage that are strictly necessary to remember your sign-in, preferences and privacy choice and to keep the service working. If you open a friend’s referral link, we keep that link’s code in your browser’s local storage for up to three days so it can be linked to your account when you sign up, then remove it. PostHog analytics storage is off by default and starts only if you choose Analytics only or Analytics & replay. You can change or withdraw that choice at any time with the Privacy choices button. We do not use advertising trackers.",
    "Service providers",
    "Supabase — authentication and database; Cloudflare — hosting, storage, video and security; PostHog — optional analytics and replay; Sentry — necessary server diagnostics; Fly.io — media scanning and rendering; Expo — push delivery; fal.ai — generation; Crun — generation; Higgsfield — planned generation (prompts, reference images and generation settings; trains on outputs unless the account-level Console opt-out is on, which we must enable before using this provider); Kie.ai — generation; GrsAI — generation; OpenRouter — model gateway and chat; ElevenLabs — speech generation; Exa — optional web search; Parallel — optional web search; Resend — service email; RevenueCat — store purchase coordination; Stripe — checkout and subscriptions; separate controller for Merchant of Record purchases; Apple — sign-in, store purchases and push transport; Google — sign-in and store purchases; BytePlus — planned video generation.",
    "Retention periods for store customer records, referral rewards, security events and push records are being finalised.",
    "Where data is processed",
    "Our database, which holds account data, the credit ledger, generation metadata and chat conversations, is hosted in the European Union (Frankfurt, Germany). Generated media is stored in the European Union, in Cloudflare R2 with an EU jurisdictional restriction. Model providers may process your prompt and reference files outside the UK or EEA for the duration of the generation. For every transfer outside the UK or EEA we rely on the UK International Data Transfer Agreement or the EU Standard Contractual Clauses with the processor concerned.",
    "See  for service providers, retention and the lawful bases for each purpose.",
    "Privacy Policy",
    "Credit packs are sold through Stripe Checkout. Under Stripe Managed Payments, Stripe, Inc. is the Merchant of Record and the seller of record for your credit pack purchase: Stripe takes the payment, charges and remits any VAT or sales tax due for your location, and issues your receipt. The total including tax is shown before you pay. Veyrnox Ltd provides the Veyrnox.ai service that the credits are spent on, and these terms govern your use of it. Stripe handles your card details; we never see them.",
    "You can stop renewal from the Publish Plan page or its Stripe billing portal. You will not be charged for another cycle, and paid features continue until the displayed paid-period end.",
    "You can cancel from the Cinema Pass page or use its Stripe billing portal. Outside the initial cooling-off period, cancellation stops the next renewal and access continues until the displayed paid-period end.",
    "You can stop weekly, monthly or annual renewal from the Publish Plan page or its Stripe billing portal. The Plan continues until the current paid period ends.",
    "You can cancel from the Cinema Pass page or its Stripe billing portal. After the initial cooling-off period, cancellation stops renewal and the Pass continues until the current paid period ends."
];
const isRetiredSupplierDisclosure = (route, field, expected) => ['/legal/privacy', '/legal/gdpr', '/legal/terms', '/legal/refund'].includes(route) && ['descriptions', 'headings'].includes(field)
    && retiredSupplierDisclosure.some(old => old === expected || old.includes(expected) || expected.includes(old));
// ADR-0262: each attachment supplies its own type; the global media-type
// selector and the single-selection instruction were replaced by an ordered strip.
const retiredPublishKnowledge = {
    controls: new Set(['Media type']),
    descriptions: new Set(['Media selected. Choose accounts, add a caption and confirm when to post.']),
};
const extendedAccountKnowledge = new Set([
    'When a friend you refer buys their first Credit Pack, you earn Credits worth 10% of that Pack, added to your balance 14 days later if the purchase has not been refunded or disputed. Credits only; they never expire. Nothing is paid out as money.',
]);

test('phase B retains every app route knowledge item from origin/main', async () => {
    const baseline = JSON.parse(await readFile(path.join(root, 'tests/fixtures/app-knowledge-main.json'), 'utf8'));
    assert.equal(baseline.routes.length, 32);
    const words = value => value.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const entry of baseline.routes) {
        const current = AUTO_PRODUCT_INVENTORY.find(row => row.route === entry.route);
        assert.ok(current, entry.route);
        for (const [field, values] of Object.entries(entry)) {
            if (field === 'route') continue;
            const normal = ['links', 'targets'].includes(field) ? value => value : words;
            const actual = new Set(current[field].map(normal));
            for (const value of values) {
                // Film export/import and verified-master creation were retired
                // deliberately. Keep each removed item explicit so later
                // knowledge loss still requires a conscious decision.
                if (entry.route === '/app/film-studio' && retiredFilmStudioKnowledge[field]?.has(value)) continue;
                // Oddlings now uploads a source image for the recommended edit
                // pipeline instead of treating it as a local-only moodboard.
                if (entry.route === '/app/oddlings' && retiredOddlingsKnowledge[field]?.has(value)) continue;
                if (entry.route === '/app/publish' && retiredPublishKnowledge[field]?.has(value)) continue;
                if (entry.route === '/app/account' && field === 'descriptions' && extendedAccountKnowledge.has(value)
                    && [...actual].some(currentValue => currentValue.startsWith(normal(value)))) continue;
                // ADR-0326 replaces the comma-separated palette with native swatches.
                if (entry.route === '/app/editor' && field === 'descriptions' && value === 'Use up to 12 hex colours separated by commas.') continue;
                if (entry.route === '/app/chat' && retiredChatKnowledge[field]?.has(value)) continue;
                if (entry.route === '/app/create' && retiredCreateKnowledge[field]?.has(value)) continue;
                if (entry.route === '/app/editor' && retiredEditorKnowledge[field]?.has(value)) continue;
                if (field === 'descriptions' && retiredLegalKnowledge[entry.route]?.has(value)) continue;
                assert.ok(actual.has(normal(value)), `${entry.route} ${field}: ${value}`);
            }
        }
    }
});

test('generated Vey knowledge matches the current product source', async () => {
    const artifact = await buildVeyKnowledgeArtifact(root);
    const generated = await readFile(path.join(root, 'lib/generatedProductInventory.js'), 'utf8');
    assert.equal(generated, renderVeyKnowledgeModule(artifact), 'run npm run sync:vey-knowledge');
});

test('automatic knowledge inventories product routes and approved documentation', () => {
    const routes = new Set(AUTO_PRODUCT_INVENTORY.map((entry) => entry.route));
    for (const route of ['/app', '/app/create', '/app/chat', '/app/film-studio', '/app/library', '/app/credits', '/app/publish', '/models', '/presets', '/tools', '/mcp', '/social-cinema']) {
        assert.ok(routes.has(route), `missing generated route ${route}`);
    }
    assert.ok(AUTO_PRODUCT_INVENTORY.every((entry) => entry.title && entry.sourceHash));
    assert.ok(AUTO_PRODUCT_DOCS.some((entry) => entry.source === 'docs/product/film-studio.md'));
    assert.ok(AUTO_PRODUCT_DOCS.every((entry) => entry.text && entry.sourceHash));
});

test('ancestor layout notices retain knowledge after selectors switch to stable hooks', () => {
    for (const route of ['/legal/aup', '/m', '/social-cinema', '/social/review/[token]']) {
        const entry = AUTO_PRODUCT_INVENTORY.find(value => value.route === route);
        assert.ok(entry.controls.includes('Browser storage notice'), route);
        assert.ok(entry.controls.includes('Got it'), route);
    }
});

test('every app page is represented exactly once, including legal and callback routes', async () => {
    async function pages(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        return (await Promise.all(entries.map((entry) => entry.isDirectory()
            ? pages(path.join(directory, entry.name))
            : /^page\.(js|jsx|mjs|tsx)$/.test(entry.name) ? [path.join(directory, entry.name)] : []))).flat();
    }
    const sources = (await pages(path.join(root, 'app'))).map((file) => path.relative(root, file)).sort();
    assert.deepEqual(AUTO_PRODUCT_INVENTORY.map((entry) => entry.source).sort(), sources);
    assert.equal(new Set(AUTO_PRODUCT_INVENTORY.map((entry) => entry.route)).size, sources.length);
    for (const route of ['/legal/privacy', '/auth/callback', '/s/[slug]', '/social/review/[token]', '/social/team/invite/[token]', '/design-system']) {
        assert.ok(AUTO_PRODUCT_INVENTORY.some((entry) => entry.route === route), route);
    }
});

test('static translation resolution preserves English copy, rich labels and literal slots without executing code', async () => {
    const { resolveI18nSource } = await import('../scripts/lib/vey-knowledge-i18n.mjs');
    const messages = { title: 'Creator workspace', detail: 'Up to {count} minutes.', linked: 'Read {policy}.', 'label.Start frame': 'Start frame' };
    const source = `<h1>{t('title')}</h1><p>{t('detail', { count: 10 })}</p><label>{t.label('Start frame')}</label><p>{rich(t('linked'), { policy: <a href="/legal/privacy">Privacy</a> })}</p><a href={localizedHref('/m')}>Mobile</a>`;
    const resolved = resolveI18nSource(source, messages);
    assert.ok(resolved.includes('<h1>Creator workspace</h1>'));
    assert.ok(resolved.includes('<p>Up to 10 minutes.</p>'));
    assert.ok(resolved.includes('<label>Start frame</label>'));
    assert.ok(resolved.includes('<p>Read Privacy.</p>'));
    assert.ok(resolved.includes('href="/m"'));
    const linked = `<p>{rich(t('linked'), { policy: <a href={localize('/legal/privacy')}>Privacy</a> })}</p>`;
    assert.ok(resolveI18nSource(linked, messages, { attributesOnly: true }).includes('href="/legal/privacy"'));
    const dynamic = `<p>{t(serverKey)}</p><p>{t('absent')}</p><p>{dangerous()}</p>`;
    assert.equal(resolveI18nSource(dynamic, messages), dynamic);
});

test('all main route knowledge survives localization except the retired unknown-series fallback', async () => {
    const baseline = JSON.parse(await readFile(path.join(root, 'tests/fixtures/public-site-knowledge-main.json'), 'utf8'));
    // Case, typographic punctuation and link-adjacent spaces are presentation,
    // not facts. Links and assistant target identifiers must remain exact.
    const words = value => value.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    for (const [route, fields] of Object.entries(baseline.routes)) {
        const current = AUTO_PRODUCT_INVENTORY.find(entry => entry.route === route);
        assert.ok(current, route);
        for (const [field, indices] of Object.entries(fields)) {
            const normal = ['links', 'targets'].includes(field) ? value => value : words;
            const actual = new Set(current[field].map(normal));
            for (const index of indices) {
                const expected = baseline.texts[index];
                // The accepted phase-A correction calls notFound() for unknown
                // series. Do not restore nonexistent HTTP-200 fallback copy.
                if (route === '/social-cinema/series/[slug]' && field === 'descriptions' && expected === 'This series is not available.') continue;
                if (route === '/app/film-studio' && retiredFilmStudioKnowledge[field]?.has(expected)) continue;
                if (route === '/app/oddlings' && retiredOddlingsKnowledge[field]?.has(expected)) continue;
                if (route === '/app/publish' && retiredPublishKnowledge[field]?.has(expected)) continue;
                if (route === '/app/chat' && retiredChatKnowledge[field]?.has(expected)) continue;
                if (route === '/app/create' && retiredCreateKnowledge[field]?.has(expected)) continue;
                if (route === '/app/editor' && retiredEditorKnowledge[field]?.has(expected)) continue;
                if (field === 'descriptions' && retiredLegalKnowledge[route]?.has(expected)) continue;
                if (isRetiredSupplierDisclosure(route, field, expected)) continue;
                // A hidden h2 that came before the page's h1 (WCAG 1.3.1); the
                // brand name is still the page title and the logo's name.
                if (route === '/' && field === 'headings' && expected === 'Veyrnox.ai') continue;
                if (route === '/presets/[id]' && field === 'headings' && expected === 'PROMPT') continue;
                if (route === '/presets/[id]' && field === 'controls' && expected === 'Template prompt') continue;
                assert.ok(actual.has(normal(expected)), `${route} ${field}: ${expected}`);
            }
        }
    }
    const series = await readFile(path.join(root, 'app/veyrnox/social-cinema/series/[slug]/page.js'), 'utf8');
    assert.match(series, /if \(!series\) notFound\(\)/);
});
