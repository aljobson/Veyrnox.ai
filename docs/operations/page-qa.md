# Page coverage and performance checks

`npm run sync:vey-knowledge` inventories every `app/**/page.*` file, including legal pages, callbacks, public token pages, admin and design-system routes. Canonical URLs strip the internal `/veyrnox` prefix. `tests/productKnowledgeSync.test.mjs` fails if any source page is missing or duplicated.

The read-only browser sweep combines that inventory with every concrete URL in the live sitemap. Its JSON artifact records each template, URL, status, access boundary, viewport overflow, document size, DOM size and timing. Desktop and mobile anonymous projects always run. Supply `QA_STORAGE_STATE` to add the authenticated project using a browser-exported state file; keep that file outside Git because it contains credentials.

```sh
npm install --no-save --no-audit --no-fund @playwright/test@1.63.0 @axe-core/playwright@4.10.2
npx playwright install chromium
QA_BASE_URL=http://127.0.0.1:3100 npx playwright test -c e2e/page-coverage.config.mjs
QA_BASE_URL=https://veyrnox.ai QA_ALLOW_PRODUCTION=1 npx playwright test -c e2e/page-coverage.config.mjs
```

For authenticated checks add `QA_STORAGE_STATE=/absolute/private/path/session.json`. The harness blocks all non-read browser requests except same-origin `POST /api/auth/session` with `action: refresh`, which hydrates an existing HttpOnly cookie. The sweep never clicks Generate, Buy, Publish, Delete or Connect. Supply `QA_PAGE_FIXTURES` as a JSON object mapping a route template to a deterministic fixture URL, for example `{"/app/projects/[id]":"/app/projects/test-project-id"}`. Unavailable dynamic fixtures use an explicit `negative-path` result; this proves controlled rejection only. Admin routes can prove the Cloudflare Access boundary without claiming admin feature coverage. Real approval/invitation/OAuth success, third-party publishing and provider generation require separate authorized workflow tests and fixtures. Traces and screenshots are disabled to avoid putting session headers or account content in artifacts; the report contains metrics and accessibility selectors.

Budgets are 5 seconds cold TTFB, 800 KiB uncompressed HTML, fewer than 3,000 DOM nodes, at most 2 pixels document overflow, and no critical/serious WCAG A/AA axe violations in the first-party document. Third-party player frames are outside this accessibility check. `/app` and `/presets` initially show 12 cards, capped at 20 total image nodes; Show more must reveal the next 12 without losing filter access. One worker runs at a time; accessibility scans have a 20-second deadline. Failures and partial JSON are saved after each page so a stalled page does not hide the remaining results. HTML reports and JSON attachments are retained on CI/nightly runs.

## Public HTML caching

`private, no-store` is intentional under [ADR-0060](../adr/0060-csp-rendering-decision.md): each HTML response has a fresh script nonce and a matching CSP. Shared HTML caching would reuse nonce-bearing documents and is not a safe performance fix. Static assets, public catalog data and metadata have independent cache policies. The gallery reduces initial rendering work without changing that security contract. A future public HTML cache requires a separately reviewed hash-based CSP or origin/session architecture.
