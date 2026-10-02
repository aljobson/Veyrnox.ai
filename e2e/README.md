# e2e — browser smoke tests

Three journeys against **staging**, in Chromium (docs/product/ISSUES.md I5):

| Spec | What is real | What is stopped |
|---|---|---|
| `signup.spec.mjs` | the sign-up dialog, browser validation, the Turnstile gate | any call to `/auth/v1/signup` is aborted and fails the test |
| `generate.spec.mjs` | sign-in, `/api/v1/account`, the catalog, the create form | `POST /api/v1/generations` is answered with `insufficient_balance` |
| `buy.spec.mjs` | sign-in, `/api/v1/balance`, `/api/v1/credit-packs`, consent gate | `POST /api/v1/top-ups` and the Stripe page are answered by the test |

Nothing debits credits, calls a provider, or writes a Top-up, so the shared
staging database needs no clean-up. Production is refused (`e2e/env.mjs`).

## Running

```bash
npm install --no-save @playwright/test@1.63.0
npx playwright install chromium
E2E_EMAIL=… E2E_PASSWORD=… npx playwright test -c e2e/playwright.config.mjs
```

Without `E2E_EMAIL` / `E2E_PASSWORD`, generate and buy are skipped. They must
name a **confirmed account on the staging Supabase project**; staging has no
CAPTCHA on sign-in, so the tests sign in through Auth's password grant and put
the session in `localStorage` the way `app/lib/authClient.js` does.
`E2E_BASE_URL` points the run at another staging-backed origin (a branch
preview).

`.github/workflows/e2e.yml` runs this daily and on demand, with the account in
the `E2E_EMAIL` and `E2E_PASSWORD` repository secrets.

Playwright stays out of `package.json` on purpose, installed ad hoc like
`tsx` (CLAUDE.md, bundler traps): the Workers build has no use for it.
