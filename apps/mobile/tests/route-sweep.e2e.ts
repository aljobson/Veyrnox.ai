import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openSignedIn } from './helpers.js';

// Route sweep: opens every static screen by deep link, takes a screenshot, and fails on a crash, an unmatched route
// or a generic error screen. It never taps anything, so it cannot spend credits or change account state.
const CHUNKS: string[][] = [["about", "account", "analytics-consent", "appeals", "appearance", "blocked", "brand-kit", "chat", "chat/folders", "chat/library", "chat/move", "chat/new"], ["chat/personas", "chat/skills", "cinema", "cinema/analytics", "cinema/comments", "cinema/creator", "cinema/creator/draft", "cinema/probe", "cinema/report-comment", "create", "create/agent", "create/presets"], ["create/tools", "credits", "delete-account", "developers", "edit", "editor", "editor/new", "email", "face-filters", "faceless-reel", "features", "film"], ["film/cloud", "film/workspace", "guides", "help", "history", "language", "library", "library/files", "mcp", "models", "oauth-consent", "oddlings"], ["oddlings/build", "oddlings/saved", "passkey", "paywall", "preview", "pricing", "privacy-choices", "privacy-export", "projects", "publish", "publish/accounts", "publish/activity"], ["publish/ads", "publish/ads-edit", "publish/analytics", "publish/approval-new", "publish/approvals", "publish/autolist-edit", "publish/autolists", "publish/best-time", "publish/brands", "publish/calendar", "publish/commerce", "publish/commerce-edit"], ["publish/compose", "publish/connect", "publish/contact-edit", "publish/contact-import", "publish/contacts", "publish/developer", "publish/drafts", "publish/inbox", "publish/inbox-analytics", "publish/inbox-thread", "publish/posts", "publish/queue-edit"], ["publish/queues", "publish/report-edit", "publish/reports", "publish/smartlink", "publish/team", "publish/workflows", "rate", "referrals", "report", "review", "search", "security"], ["start", "team-invite", "topups", "vibe", "wins"]];

const BAD = ['Unmatched Route', 'Something went wrong', 'Uncaught Error', 'This screen doesn\u2019t exist', "This screen doesn't exist"];

CHUNKS.forEach((routes, index) => {
  test(`route sweep ${index + 1}/${CHUNKS.length}: ${routes[0]} .. ${routes[routes.length - 1]}`, { tags: ['sweep'] }, async ({ app, device, screen }) => {
    await openSignedIn(app, screen);
    const failures: string[] = [];
    for (const route of routes) {
      await device.openLink(`ai.veyrnox.app://${route}`);
      await new Promise(resolve => setTimeout(resolve, 1_500));
      for (const text of BAD) {
        if (await screen.getByText(text).isVisible()) failures.push(`${route}: shows "${text}"`);
      }
      await app.screenshot(`sweep-${route.replace(/\//g, '_')}`);
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
