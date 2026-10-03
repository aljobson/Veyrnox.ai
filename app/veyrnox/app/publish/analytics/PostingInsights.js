'use client';
import { useEffect, useState } from 'react';
import { getSocialPostingInsights } from '../../../../lib/socialAnalyticsClient';
import { summarizePostingInsights, MIN_SLOT_POSTS, MIN_MEASURED_POSTS, MIN_HISTORY_DAYS } from '../../../../../lib/social/postingInsights.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;
const tones = ['bg-vx-accent/10', 'bg-vx-accent/20', 'bg-vx-accent/30', 'bg-vx-accent/40'];

export function PostingInsights({ accountId }) {
    const [result, setResult] = useState(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        getSocialPostingInsights(accountId).then((data) => { if (active) setResult(data); })
            .catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [accountId, attempt]);
    if (error) return <section className="rounded-2xl border border-vx-border p-5">
        <h2 className="font-bold mb-2">Posting insights</h2>
        <p role="alert" className="text-sm text-vx-danger mb-3">Could not load posting insights. Your other analytics are still available.</p>
        <button type="button" className="rounded-full border border-vx-border px-4 py-2 text-sm font-bold"
            onClick={() => { setError(false); setAttempt((n) => n + 1); }}>Try again</button>
    </section>;
    if (!result) return <p role="status" className="text-sm text-vx-fg-muted">Loading posting insights…</p>;
    const data = result.insights;
    if (!data) return <section className="rounded-2xl border border-vx-border p-5">
        <h2 className="font-bold mb-2">Posting insights</h2>
        <p className="text-sm text-vx-fg-body">Your first timing and frequency insights arrive after the next successful analytics update.</p>
    </section>;
    const summary = summarizePostingInsights(data);
    const start = new Date(`${data.period_start}T12:00:00Z`).toLocaleDateString();
    const end = new Date(`${data.period_end}T12:00:00Z`).toLocaleDateString();
    return <div className="space-y-6">
        <section className="rounded-2xl border border-vx-border p-5 space-y-4" aria-labelledby="best-time-heading">
            <div>
                <h2 id="best-time-heading" className="font-bold">Best time to post</h2>
                <p className="text-xs text-vx-fg-muted mt-1">Historical performance · {data.timezone} · twelve complete weeks, {start} to {end} (end excluded)</p>
            </div>
            {summary.topSlots.length ? <>
                <p className="text-sm text-vx-fg-body">Your strongest observed slots: {summary.topSlots.map((slot) =>
                    `${DAYS[slot.day - 1]} ${hourLabel(slot.hour)} (${number.format(slot.score)} interactions per post, ${slot.posts} posts)`
                ).join('; ')}.</p>
                <Heatmap summary={summary} />
                <p className="text-xs text-vx-fg-muted">Darker cells have more average interactions per post. — means fewer than {MIN_SLOT_POSTS} measured posts. Each hour covers its full hour in {data.timezone}.</p>
            </> : <p className="text-sm text-vx-fg-body">There is not enough evidence to recommend a time yet. We need at least {MIN_MEASURED_POSTS} measured posts spanning {MIN_HISTORY_DAYS} days, with {MIN_SLOT_POSTS} in a weekday/hour slot and some recorded interactions. Try several days and hours as you build history.</p>}
            <p className="text-xs text-vx-fg-muted">{data.measured_posts} measured of {data.recorded_posts} recorded posts. Scores use lifetime likes and comments, plus shares and saves when available, on posts at least 48 hours old. They describe past performance, not when your audience is online or what caused engagement. Older posts have had longer to earn interactions.</p>
        </section>
        <section className="rounded-2xl border border-vx-border p-5 space-y-4" aria-labelledby="frequency-heading">
            <h2 id="frequency-heading" className="font-bold">Posting frequency and engagement</h2>
            <p className="text-sm text-vx-fg-body">Compare weeks with the same number of recorded posts. Averages use measured posts only; this does not show that posting more caused higher engagement.</p>
            <div className="relative overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" tabIndex={0} role="region" aria-label="Posting frequency comparison">
                <table className="w-full text-sm">
                    <caption className="sr-only">Recorded weekly posting frequency and average lifetime interactions per measured post</caption>
                    <thead><tr className="text-left text-xs text-vx-fg-muted">
                        <th scope="col" className="pb-2 pr-3">Posts per week</th>
                        <th scope="col" className="pb-2 pr-3">Weeks</th>
                        <th scope="col" className="pb-2 pr-3">Measured posts</th>
                        <th scope="col" className="pb-2 text-right">Avg. interactions per post</th>
                    </tr></thead>
                    <tbody>{summary.frequency.map((group) => <tr key={group.postsPerWeek} className="border-t border-vx-border tabular-nums">
                        <th scope="row" className="py-2 pr-3 text-left">{group.postsPerWeek}</th>
                        <td className="py-2 pr-3">{group.weeks}</td>
                        <td className="py-2 pr-3">{group.measuredPosts}</td>
                        <td className="py-2 text-right">{group.score === null ? '—' : number.format(group.score)}</td>
                    </tr>)}</tbody>
                </table>
            </div>
            <p className="text-xs text-vx-fg-muted">This covers posts Veyrnox has collected, which may omit older, private or deleted posts. Zero means no stored posts for those weeks. Insights refresh weekly after a successful analytics update. Computed {new Date(data.computed_at).toLocaleString()}.</p>
        </section>
    </div>;
}

function Heatmap({ summary }) {
    return <div className="relative overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-vx-accent" tabIndex={0} role="region" aria-label="Weekday and hour performance heatmap">
        <table className="w-full min-w-[680px] border-separate border-spacing-1 text-xs tabular-nums">
            <caption className="sr-only">Average lifetime interactions per post by local weekday and publication hour</caption>
            <thead><tr><th scope="col"><span className="sr-only">Day</span></th>{HOURS.map((hour) =>
                <th scope="col" key={hour} className="font-normal text-vx-fg-muted">{String(hour).padStart(2, '0')}</th>)}</tr></thead>
            <tbody>{DAYS.map((day, i) => <tr key={day}><th scope="row" className="pr-2 text-left font-bold">{day}</th>
                {HOURS.map((hour) => {
                    const cell = summary.cells.find((c) => c.day === i + 1 && c.hour === hour);
                    const measured = cell?.posts >= MIN_SLOT_POSTS && Number.isFinite(cell.score);
                    const label = measured ? `${number.format(cell.score)} avg. interactions, ${cell.posts} posts` : `${cell?.posts || 0} measured posts; insufficient sample`;
                    const tone = measured ? tones[Math.min(3, Math.floor(cell.score / summary.maxScore * 3))] : 'bg-vx-panel';
                    return <td key={hour} className={`${tone} rounded px-1 py-2 text-center`} title={`${day} ${hourLabel(hour)}: ${label}`}>
                        <span aria-hidden="true">{measured ? number.format(cell.score) : '—'}</span>
                        <span className="sr-only">{label}</span>
                    </td>;
                })}</tr>)}</tbody>
        </table>
    </div>;
}
