import { formatNumber, t } from './i18n';
import { MIN_SLOT_POSTS, summarizeInsights, type Insights } from './publishInsights';

const DAYS = ['publish.monday', 'publish.tuesday', 'publish.wednesday', 'publish.thursday', 'publish.friday', 'publish.saturday', 'publish.sunday'];
export const dayName = (day: number) => t(DAYS[day - 1]);
export const hourText = (h: number) => `${formatNumber(h).padStart(2, formatNumber(0))}:${formatNumber(0)}${formatNumber(0)}`;
export const scoreText = (n: number) => formatNumber(Math.round(n * 10) / 10);
export function heatGrid(insights: Insights) {
    const max = summarizeInsights(insights).topSlots[0]?.score ?? 0;
    return Array.from({ length: 24 }, (_, hour) => Array.from({ length: 7 }, (_, index) => {
        const day = index + 1;
        const cell = insights.cells.find(c => c.day === day && c.hour === hour) ?? { day, hour, posts: 0, score: null };
        const measured = cell.posts >= MIN_SLOT_POSTS && cell.score !== null && Number.isFinite(cell.score);
        return { ...cell, measured, level: measured ? (max === 0 ? 0 : Math.min(3, Math.floor(cell.score! / max * 3))) : null };
    }));
}
