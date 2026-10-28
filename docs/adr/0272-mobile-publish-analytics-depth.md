# ADR-0272: Publish analytics depth and report templates on the phone

Status: Implemented in the frozen work order; independent review and host simulator proof pending.

The phone uses the existing brand-scoped social analytics and reports routes. No server,
web, migration, feature flag or endpoint contract changes. Two or more active supported
accounts default to a portfolio. Current and comparison requests settle independently;
comparisons include only accounts available in both periods. A 402 keeps the analytics
UnlockCard. Missing provider metrics remain absent, rather than becoming zeros.

The analytics port keeps the web's arithmetic, ranking, CSV columns, CRLF separators,
quoting and formula guard. A Node parity test imports the actual web module and compares
CSV bytes and type, top-content, hashtag and portfolio results. The account parser adds
rawDisplayName and externalAccountId without changing displayName. CSV account labels
use the raw name or external id, preserving empty and whitespace-name behavior.

CSV exports use only the loaded data, are written into exportDirectory(), and open the
native share sheet with text/csv and public.comma-separated-values-text. Files are deleted
when sharing resolves or rejects, on unmount, and when the API identity changes. The
existing auth cache lifecycle also clears this directory on sign-out/account change.
No captions, report names, email addresses, messages or file names are logged. Captions
are bounded plain text; permalinks are exported only through the parsed HTTPS link and
are never opened. Unicode hashtag syntax is constructed once in try/catch, with the
specified Latin/BMP fallback for Hermes engines without Unicode property escapes.

Report templates open analytics through validated report parameters, including a title
and a four-point start border. Owner, manager, editor and analyst roles can create,
edit and delete templates. Writes use the existing camelCase JSON contract. Delete is
confirmed with the report name; report exports retain their existing PDF/Slides behavior.

Scheduling follows the server facts rather than the web form's rollout shortcut:

- Both scheduling and delivery on: cadence, timing and delivery are editable. A legacy
  scheduled template needs at least one valid recipient before saving.
- Scheduling on, delivery off: new/manual templates remain manual. Scheduled templates
  with recipients allow cadence/timing changes and preserve recipients, format,
  reply-to and message unchanged, with those fields read-only.
- Scheduling off, or delivery off with a recipient-free scheduled template: the saved
  template is read-only. Its only write is a confirmed conversion to manual using its
  saved fields and unchanged delivery payload. Cancel sends nothing.
- Manual templates remain editable; no unavailable scheduling choice is offered.

The reasons are app/api/v1/social/reports/route.js:66 (scheduled writes require the
scheduling flag), :74 (non-manual writes require recipients), and
0323_social_report_exports_delivery.sql:4 (recipients were added with an empty default).
The sweep in lib/social/reportSchedule.js needs both flags. Thus a schedule save with
both flags on explicitly confirms email cadence, address count and format; with delivery
off it explicitly says nothing will be sent until delivery is enabled. Turning a schedule
off separately confirms that automatic delivery ends. No confirmation itself sends mail.

Web follow-up: its current schedule form offers non-manual cadence without delivery
fields and says the schedule can be saved, while the route rejects empty recipients.
This work intentionally leaves that web behavior unchanged.

All 86 new keys live in publishReporting, with machine translations in all ten app
locales under ADR-0270. There are no new plural families or dynamic translation families.

Frozen-work-order constraints discovered during implementation:

- Existing locale catalogs and dev/mock-server.mjs already exceed 500 lines. They retain
  scoped additions; all new source and test files stay below 500 lines.
- check-app-i18n.mjs --write omits non-English plural categories when no exact English
  key exists. appTranslations.test.ts requires those rows using the English other form.
  Per the host disposition, Arabic, Spanish and French review files now use the test's
  exact computation: existing plural rows are restored and new reporting rows retained.
  Neither the generator nor the test was changed. The unchanged checker therefore reports
  these files as stale. Proposed separate follow-up: align the generator/checker with the
  test's plural fallback; do not regenerate away the restored entries.
- HEAD is the frozen 8924dc917; the local origin/main reference has advanced. The literal
  origin/main diff includes unrelated committed changes. Review this work against HEAD
  (plus untracked additions); do not rewrite unrelated history to satisfy that check.
- The host has run the full proof and requested the accessibility and plural-review
  corrections. The subsequent independent inspection reserves header roles for section
  headings; account, content-format and hashtag row labels retain their appearance
  without becoming screen-reader headings.

Earlier host-requested correction proof (historical, advisory):

```sh
cd apps/mobile && npx tsc --noEmit && npx jest --ci a11yAudit appTranslations translatedControls publishCarousel && node scripts/gen-en-registry.mjs --check && node scripts/check-app-i18n.mjs
```

TypeScript exited 0 with no diagnostics. All four requested Jest suites passed:
1,450 tests, zero failures, 23.245 seconds. The English registry check passed with
`English registry is current.` The final checker exited 1 with
`Stale length review: ar`, because it excludes the restored plural-form rows.
Per the host instruction, review files match the test's computation; neither the
generator nor the tests were changed. Arabic restored 24 existing plural rows,
Spanish restored two, and French restored one. All new reporting entries remain.
The resulting review counts are 263, 423 and 698 respectively. These three review
diffs contain additions only relative to the frozen HEAD. `git diff --check` passes.

This correction pass changes ContentPerformance.tsx, those three length-review files,
and this ADR. It adds no paths outside the frozen whitelist. No commit, push or publish
was performed. Automatic approval rejected creating an external proof-log artifact
under /private/tmp as outside the project; the results are recorded here instead.

Independent inspection corrections:

- Single-account load failures retain the first current-period rejection and use the
  existing offline, missing-account and rate-limit messages with an alert role and
  danger colour. Portfolio all-failed loads retain their generic message.
- The report editor settles reports and accounts independently. If accounts fail but
  reports load, the editor offers All accounts and preserves the saved account id with
  its existing unavailable-account note.
- Row labels are distinct from section headings, with unchanged visual styling.
- Both schedule confirmations use a count-independent recipient label in English and
  all ten translations. No plural family was added. The host owns length-review
  regeneration; a read-only comparison found all ten reviews unchanged by this copy.

These changes address only inspection findings M1 and L1-L3, with regression coverage
in the existing analytics/report screen test files. The checker and audit tests remain
unchanged. No commit, push or publish was performed.

Independent-inspection correction proof (current, advisory):

```sh
cd apps/mobile && npx tsc --noEmit && npx jest --ci a11yAudit appTranslations publishAnalytics publishReport && node scripts/gen-en-registry.mjs --check
```

The complete requested command exited 0. TypeScript produced no diagnostics; all six
Jest suites passed (1,521 tests, 47.87 seconds); the registry check printed
`English registry is current.` Jest also warned that a worker did not exit gracefully
and was force-exited; this was a warning, not a test or command failure. No unrelated
teardown changes were made. The final locale checker was not part of the host's revised
command, and its script and all review files were left unchanged in this correction pass.

Files changed in this pass: analytics.tsx, report-edit.tsx, AnalyticsPortfolio.tsx,
ContentPerformance.tsx, publishAnalyticsScreen.test.tsx, publishReportsScreen.test.tsx,
the English publishReporting area, its two confirmation values in each of the ten app
locale catalogs, and this ADR. All are on the frozen whitelist. No new denied or blocked
actions occurred, and no additional deviations were needed for the inspection fixes.

Host verification still requires the default iPhone 17 Pro simulator against this
checkout's mock fixtures with MOCK_PUBLISH_ANALYTICS=1, then MOCK_REPORT_FLAGS=noschedule
and nodelivery. Verify the share sheet and spreadsheet opening, template CRUD,
confirmation/cancel behavior, read-only schedule conversion, and hashtag rendering in
Hermes. No extra native environment or simulator was created for this work.
