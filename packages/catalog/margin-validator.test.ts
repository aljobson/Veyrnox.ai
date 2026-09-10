/**
 * §5.10 CI gate — the catalog must satisfy the margin floor at the
 * reference conversion rate. If this test fails, either the retail
 * credit price is too low or the provider cost has climbed and we
 * need to reprice.
 *
 * Runs standalone via `node --test` — no DB required.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CATALOG, MARGIN_FLOOR, REFERENCE_DOLLARS_PER_CREDIT } from "./index.ts";
import { findMarginBreaches, marginSummary } from "./margin-validator.ts";

test("margin_floor gate — no catalog row is below floor at reference rate", () => {
    const breaches = findMarginBreaches();
    if (breaches.length > 0) {
        const table = breaches
            .map(
                (b) =>
                    `  ${b.id.padEnd(20)} cost=$${b.provider_cost_usd.toFixed(3)} ` +
                    `retail=$${b.retail_at_ref_rate_usd.toFixed(3)} ` +
                    `need>=$${b.required_min_usd.toFixed(3)} ` +
                    `short=$${b.shortfall_usd.toFixed(3)} ` +
                    `margin=${(b.actual_margin_frac * 100).toFixed(1)}%`
            )
            .join("\n");
        assert.fail(
            `\n${breaches.length} catalog row(s) breach the ${MARGIN_FLOOR * 100}% margin floor ` +
                `at $${REFERENCE_DOLLARS_PER_CREDIT}/credit:\n${table}\n\n` +
                `Fix: raise credits, drop the model, or gate it.`
        );
    }
});

test("margin_floor gate — every row prints a summary for the log", () => {
    const rows = marginSummary();
    assert.ok(rows.length > 0, "catalog is empty");
    // Log for humans — visible in CI output
    for (const r of rows) {
        console.log(
            `  ${r.id.padEnd(20)} cost=$${r.provider_cost_usd.toFixed(3)} ` +
                `retail=$${r.retail_at_ref_rate_usd.toFixed(3)} ` +
                `margin=${(r.actual_margin_frac * 100).toFixed(1)}% ${r.healthy ? "OK" : "FAIL"}`
        );
    }
});

test("catalog invariants — ids unique, credits positive", () => {
    const ids = new Set<string>();
    for (const row of CATALOG) {
        assert.ok(!ids.has(row.id), `duplicate catalog id: ${row.id}`);
        ids.add(row.id);
        assert.ok(row.credits > 0, `${row.id}: credits must be positive`);
        assert.ok(row.provider_cost_usd >= 0, `${row.id}: provider_cost_usd must be non-negative`);
        assert.ok(row.retail_usd >= 0, `${row.id}: retail_usd must be non-negative`);
        assert.ok(row.providers.length > 0, `${row.id}: at least one provider`);
    }
});
