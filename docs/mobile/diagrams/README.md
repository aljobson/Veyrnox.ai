# Mobile diagrams

`mobile-journey.workflow.json` is the source of an Archify workflow diagram: first launch to a live post, with the status of each step and the owner steps that block it.

The rendered HTML is not committed. It embeds the Archify viewer script, which CodeQL flags (`js/remote-property-injection`), and it is regenerated from the JSON in one command:

```bash
node ~/.claude/skills/archify/bin/archify.mjs deliver workflow docs/mobile/diagrams/mobile-journey.workflow.json mobile-journey.html --quality showcase
```

Checked 2026-10-19: 9 of 9 showcase checks, 0 errors, 0 warnings; the browser check passes at 1440x900, 1600x1000, 1920x1080 and 2048x1320. The statuses in the diagram are a snapshot of that day and go stale as PRs merge.
