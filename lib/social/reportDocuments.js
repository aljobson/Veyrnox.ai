const enc = new TextEncoder();
const text = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
const metric = (value) => Number.isFinite(value) ? new Intl.NumberFormat('en-GB').format(value) : 'Not supplied';
const xml = (value) => text(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const pdf = (value) => text(value).replace(/[^\x20-\x7e]/g, '?').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
const safeName = (value) => text(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'veyrnox-report';

export function reportFilename(template, format) {
    return `${safeName(template.name)}.${format === 'pptx' ? 'pptx' : 'pdf'}`;
}

function reportLines(template, data) {
    const p = data.current.portfolio;
    const lines = [
        template.report_title || template.name,
        `Veyrnox Publish report | ${data.range.from} to ${data.range.to}`,
        `Accounts ${metric(p.accounts)} | Followers ${metric(p.followers)} | Posts ${metric(p.posts)}`,
        `Interactions ${metric(p.interactions)} | Reach ${metric(p.reach)} | Views ${metric(p.views)}`,
    ];
    if (data.previous) lines.push(`Previous period interactions ${metric(data.previous.portfolio.interactions)} | Posts ${metric(data.previous.portfolio.posts)}`);
    lines.push('Connected accounts');
    for (const row of p.rows) lines.push(`${row.account.network}: ${row.account.display_name || row.account.external_account_id || 'Account'} | followers ${metric(row.summary.followers)} | posts ${metric(row.summary.posts)} | interactions ${metric(row.summary.interactions)} | reach ${metric(row.reach)} | views ${metric(row.views)}`);
    if (template.include_content) {
        const posts = data.current.entries.flatMap((entry) => entry.data.posts.map((post) => ({ ...post, network: entry.account.network })));
        lines.push('Top content');
        for (const post of posts.sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, 8)) lines.push(`${post.network} ${String(post.published_at || '').slice(0, 10)}: ${text(post.caption || 'Untitled post').slice(0, 90)}`);
    }
    lines.push('Metrics marked “Not supplied” were not returned by the connected network.');
    return lines;
}

export function buildReportPdf(template, data) {
    const lines = reportLines(template, data).slice(0, 36);
    const stream = ['BT', '/F1 11 Tf', '48 790 Td', '15 TL'];
    lines.forEach((line, index) => stream.push(`${index ? 'T* ' : ''}(${pdf(line)}) Tj`));
    stream.push('ET');
    const body = stream.join('\n');
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${enc.encode(body).length} >>\nstream\n${body}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(enc.encode(out).length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = enc.encode(out).length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return enc.encode(out);
}

let crcTable;
function crc32(bytes) {
    crcTable ||= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0;
}
function u16(n) { return Uint8Array.of(n & 255, (n >>> 8) & 255); }
function u32(n) { return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); }
function join(parts) { const size = parts.reduce((n, item) => n + item.length, 0); const out = new Uint8Array(size); let at = 0; for (const part of parts) { out.set(part, at); at += part.length; } return out; }
function zip(entries) {
    const locals = [], central = []; let offset = 0;
    for (const [name, source] of entries) {
        const nameBytes = enc.encode(name), data = typeof source === 'string' ? enc.encode(source) : source, crc = crc32(data);
        const local = join([u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data]);
        locals.push(local);
        central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
        offset += local.length;
    }
    const directory = join(central);
    return join([...locals, directory, u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]);
}
function slide(title, lines) {
    const paragraphs = [title, ...lines].map((line) => `<a:p><a:r><a:rPr lang="en-GB" sz="${line === title ? 2600 : 1500}" b="${line === title ? 1 : 0}"/><a:t>${xml(line)}</a:t></a:r><a:endParaRPr lang="en-GB"/></a:p>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Report content"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="5943600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
export function buildReportPptx(template, data) {
    const lines = reportLines(template, data); const slides = [lines.slice(1, 5), lines.slice(5, 14), lines.slice(14, 24)].filter((item) => item.length);
    const slideIds = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
    const rels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`, ...slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)].join('');
    const overrides = slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
    const entries = [
        ['[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${overrides}</Types>`],
        ['_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>'],
        ['ppt/presentation.xml', `<?xml version="1.0"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
        ['ppt/_rels/presentation.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`],
        ['ppt/slideMasters/slideMaster1.xml', '<?xml version="1.0"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'],
        ['ppt/slideMasters/_rels/slideMaster1.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>'],
        ['ppt/slideLayouts/slideLayout1.xml', '<?xml version="1.0"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>'],
        ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>'],
        ['ppt/theme/theme1.xml', '<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Veyrnox"><a:themeElements><a:clrScheme name="Veyrnox"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="334155"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="38BDF8"/></a:accent1><a:accent2><a:srgbClr val="8B5CF6"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="F59E0B"/></a:accent4><a:accent5><a:srgbClr val="EF4444"/></a:accent5><a:accent6><a:srgbClr val="6366F1"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="Veyrnox"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Veyrnox"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>'],
        ...slides.flatMap((content, i) => [[`ppt/slides/slide${i + 1}.xml`, slide(i === 0 ? (template.report_title || template.name) : i === 1 ? 'Connected accounts' : 'Content', content)], [`ppt/slides/_rels/slide${i + 1}.xml.rels`, '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>']]),
    ];
    return zip(entries);
}

export function buildReportDocument(template, data, format) {
    if (format === 'pptx') return { bytes: buildReportPptx(template, data), contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', filename: reportFilename(template, format) };
    return { bytes: buildReportPdf(template, data), contentType: 'application/pdf', filename: reportFilename(template, 'pdf') };
}
