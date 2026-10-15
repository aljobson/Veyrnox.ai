// Vector PDF, shared by Worker email delivery and browser downloads.
const enc = new TextEncoder();
const finite = Number.isFinite;
const metric = (n) => finite(n) ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(n) : 'Not supplied';
const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, '...');
const compact = (n) => finite(n) ? new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : '-';
const short = (s, n) => clean(s).length > n ? `${clean(s).slice(0, n - 3)}...` : clean(s);
// Hex-encoded text cannot escape into PDF operators. WinAnsi preserves Latin accents.
const hex = (s) => [...clean(s)].map((c) => c.codePointAt(0) <= 255 ? c.codePointAt(0).toString(16).padStart(2, '0') : '3f').join('');
const rgb = (c) => c.slice(1).match(/../g).map((s) => (parseInt(s, 16) / 255).toFixed(3)).join(' ');
const sum = (values) => values.some(finite) ? values.filter(finite).reduce((a, b) => a + b, 0) : null;
const interactions = (post) => sum(['likes', 'comments', 'saves', 'shares'].map((k) => post.metrics?.[k]));
const accountName = (a) => a.display_name || a.external_account_id || 'Account';
const network = (n) => ({ youtube: 'YouTube', twitter: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' })[n] || n;
function wrap(text, width, size, limit = 3) {
    const max = Math.floor(width / (size * 0.59)), chunks = clean(text).match(new RegExp(`.{1,${max}}(?:\\s|$)|.{1,${max}}`, 'g')) || [];
    return chunks.length > limit ? [...chunks.slice(0, limit - 1), short(chunks.slice(limit - 1).join(''), max)] : chunks;
}
export function buildBrandedReportPdf(template, data) {
    const accent = /^#[a-f0-9]{6}$/i.test(template.accent_color || '') ? template.accent_color : '#0284c7';
    const ink = '#142431', muted = '#546878', pale = '#f1f5f8', grid = '#dce5eb';
    const pages = [], entries = data.current.entries || [], p = data.current.portfolio;
    const posts = entries.flatMap((e) => (e.data.posts || []).map((post) => ({ ...post, account: e.account })));
    let draw;
    const rect = (x, y, w, h, c) => draw.push(`${rgb(c)} rg ${x} ${842 - y - h} ${w} ${h} re f`);
    const line = (x, y, xx, yy, c = grid, w = 1) => draw.push(`${rgb(c)} RG ${w} w ${x} ${842 - y} m ${xx} ${842 - yy} l S`);
    const text = (s, x, y, size = 10, c = ink, bold = false) => draw.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(c)} rg 1 0 0 1 ${x} ${842 - y - size} Tm <${hex(s)}> Tj ET`);
    const para = (s, x, y, width = 515, size = 9, c = muted, limit = 3) => wrap(s, width, size, limit).forEach((s, i) => text(s.trim(), x, y + i * (size + 4), size, c));
    function page(title) {
        draw = []; pages.push(draw); rect(0, 0, 595, 9, accent);
        text('VEYRNOX.ai', 40, 29, 19, ink, true); text('PUBLISH / ANALYTICS', 378, 36, 9, muted, true);
        line(40, 66, 555, 66); text(title, 40, 82, 25, ink, true);
        text(`${data.range.from} to ${data.range.to}  |  UTC`, 40, 118, 10, muted);
        line(40, 793, 555, 793); text('Veyrnox Publish / veyrnox.ai', 40, 807, 8, muted); text(`PAGE ${pages.length}`, 511, 807, 8, muted);
    }
    function heading(title, y, note) { text(title, 40, y, 15, ink, true); if (note) para(note, 40, y + 24, 515, 8.5); }
    function delta(key, value) {
        if (!template.compare_previous || !data.previous) return 'Previous period not compared';
        const old = key === 'interactions' ? sum((data.previous.entries || []).flatMap((e) => (e.data.posts || []).map(interactions))) : data.previous.portfolio[key];
        if (!finite(old) || !finite(value)) return 'Comparison not supplied';
        const change = value - old;
        return `${change > 0 ? '+' : ''}${metric(change)} vs previous period`;
    }
    page('Performance overview');
    para(template.report_title || template.name, 40, 148, 515, 12, ink, 2);
    [['Connected accounts', 'accounts', p.accounts], ['Followers / subscribers', 'followers', p.followers], ['Published content', 'posts', p.posts], ['Interactions', 'interactions', sum(posts.map(interactions))], ['Content views', 'views', p.views], ['Content reach (sum)', 'reach', p.reach]].forEach(([name, key, value], i) => {
        const x = 40 + i % 3 * 176, y = 196 + Math.floor(i / 3) * 103;
        rect(x, y, 163, 91, pale); rect(x, y, 3, 91, accent); text(name, x + 13, y + 12, 9, muted, true);
        text(metric(value), x + 13, y + 31, finite(value) ? (metric(value).length > 9 ? 18 : 26) : 16, ink, true); text(short(delta(key, value), 30), x + 13, y + 68, 8, muted);
    });
    heading('Views by connected account', 416, 'Latest view totals for content published in this period; not daily views.');
    const rows = p.rows.slice(0, 5), maximum = Math.max(1, ...rows.map((r) => finite(r.views) ? r.views : 0));
    rows.forEach((r, i) => {
        const y = 468 + i * 37;
        text(short(`${network(r.account.network)} / ${accountName(r.account)}`, 27), 40, y, 9);
        rect(215, y + 3, 249, 12, pale); if (finite(r.views) && r.views > 0) rect(215, y + 3, 249 * (r.views / maximum), 12, accent);
        text(finite(r.views) && metric(r.views).length > 11 ? compact(r.views) : metric(r.views), 473, y, 9, muted);
    });
    const noteY = Math.max(554, 474 + rows.length * 37);
    rect(40, noteY, 515, 92, pale); text('How to read this report', 54, noteY + 12, 10, ink, true);
    para('Content metrics are the latest provider snapshots for posts published in the selected dates. Reach is summed across posts and is not deduplicated. Followers are the latest available snapshot within the period. Not supplied means the network returned no value, not zero.', 54, noteY + 32, 487, 9, muted, 4);
    if (p.staleAccounts) text(`${p.staleAccounts} account(s) awaiting an update or reporting a sync error.`, 40, noteY + 105, 9, '#9a3412');
    for (const entry of entries) {
        page('Audience & publishing');
        text(short(`${network(entry.account.network)} / ${accountName(entry.account)}`, 64), 40, 150, 15, ink, true);
        const sync = entry.data.sync || {};
        para(`Last successful sync: ${sync.last_ok_at || 'Not supplied'}${sync.failing ? ' - update failed; data may be stale' : ''}`, 40, 177);
        heading('Audience over time', 218, 'Recorded follower / subscriber snapshots. Lines connect observations; missing dates are not zero.');
        const series = (entry.data.evolution || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && finite(d.metrics?.followers)).sort((a, b) => a.date.localeCompare(b.date));
        const start = Date.parse(`${data.range.from}T00:00:00Z`), end = Date.parse(`${data.range.to}T00:00:00Z`), span = Math.max(86400000, end - start);
        if (series.length) {
            const values = series.map((d) => d.metrics.followers), low = Math.max(0, Math.min(...values) - 1), high = Math.max(low + 2, ...values.map((n) => n + 1));
            for (let i = 0; i < 3; i++) { const y = 286 + i * 157 / 2; line(83, y, 531, y); text(metric(high - i * (high - low) / 2), 40, y - 5, 8, muted); }
            const coords = series.map((d) => [83 + Math.max(0, Math.min(1, (Date.parse(`${d.date}T00:00:00Z`) - start) / span)) * 448, 443 - (d.metrics.followers - low) / (high - low) * 157]);
            if (coords.length > 1) draw.push(`${rgb(accent)} RG 2 w ${coords.map(([x, y], i) => `${x.toFixed(2)} ${(842 - y).toFixed(2)} ${i ? 'l' : 'm'}`).join(' ')} S`);
            coords.forEach(([x, y]) => rect(x - 2, y - 2, 4, 4, accent));
            text(data.range.from, 83, 454, 8, muted); text(data.range.to, 475, 454, 8, muted);
            text(`${series.length} recorded snapshot${series.length === 1 ? ' - a trend needs at least two' : 's'}`, 40, 481, 9, muted);
        } else para('No audience snapshots supplied for this account and date range.', 40, 315, 515, 11);
        heading('Publishing activity', 524, 'Posts published by date, based on content returned by this network.');
        const days = Math.max(1, Math.round((end - start) / 86400000) + 1), binDays = Math.ceil(days / 30), bins = Array.from({ length: Math.ceil(days / binDays) }, () => 0);
        for (const post of entry.data.posts || []) { const day = Math.floor((Date.parse(post.published_at) - start) / 86400000); if (day >= 0 && day < days) bins[Math.floor(day / binDays)]++; }
        const top = Math.max(1, ...bins), w = 467 / bins.length;
        for (let i = 0; i < 3; i++) { const y = 584 + i * 119 / 2; line(83, y, 550, y); text(metric(top - i * top / 2), 40, y - 4, 8, muted); }
        bins.forEach((value, i) => { if (value) rect(83 + i * w + 1, 703 - 119 * value / top, Math.max(1, w - 2), 119 * value / top, accent); });
        text(data.range.from, 83, 715, 8, muted); text(data.range.to, 491, 715, 8, muted);
        text(`${binDays === 1 ? 'Daily' : `${binDays}-day buckets`} / ${(entry.data.posts || []).length} posts returned`, 40, 746, 9, muted);
    }
    if (template.include_content) {
        const key = posts.some((post) => finite(post.metrics?.views)) ? 'views' : 'interactions';
        const value = (post) => key === 'views' ? post.metrics?.views : interactions(post);
        const ranked = [...posts].sort((a, b) => (finite(value(b)) ? value(b) : -1) - (finite(value(a)) ? value(a) : -1) || String(b.published_at).localeCompare(String(a.published_at))).slice(0, 30);
        for (let offset = 0; offset < Math.max(1, ranked.length); offset += 7) {
            page('Content performance'); heading(`Top content / ${key}`, 155, `Ranked by latest reported ${key}, not performance earned during this period. Showing up to 30 of ${posts.length} posts.`);
            rect(40, 220, 515, 30, ink); text('CONTENT / ACCOUNT', 51, 229, 9, '#ffffff', true); text('VIEWS', 354, 229, 9, '#ffffff', true); text('REACH', 422, 229, 9, '#ffffff', true); text('ENGAGE*', 485, 229, 9, '#ffffff', true);
            if (!ranked.length) para('No content returned for this period.', 40, 275, 515, 11);
            ranked.slice(offset, offset + 7).forEach((post, i) => {
                const y = 253 + i * 65; if (i % 2 === 0) rect(40, y, 515, 63, pale);
                para(`${offset + i + 1}. ${post.caption || 'Untitled post'}`, 51, y + 7, 279, 9, ink, 2);
                text(short(`${network(post.account.network)} / ${accountName(post.account)} / ${String(post.published_at || '').slice(0, 10)}`, 53), 51, y + 44, 7.5, muted);
                [post.metrics?.views, post.metrics?.reach, interactions(post)].forEach((n, j) => text(finite(n) ? (metric(n).length > 8 ? compact(n) : metric(n)) : '-', [354, 422, 485][j], y + 15, 10, ink, true));
            });
            para('*ENGAGE = sum of supplied likes, comments, saves and shares. A dash means no value was supplied. Captions are shortened to fit. Missing metrics are never estimated.', 40, 728, 515, 8.5);
        }
    }
    return assemble(pages);
}
function assemble(pages) {
    const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'], kids = [];
    for (const commands of pages) {
        const id = objects.length + 1, stream = commands.join('\n'); kids.push(`${id} 0 R`);
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`, `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`);
    }
    objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
    let out = '%PDF-1.4\n'; const offsets = [];
    objects.forEach((obj, i) => { offsets.push(enc.encode(out).length); out += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
    const xref = enc.encode(out).length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return enc.encode(out);
}
