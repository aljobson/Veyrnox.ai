export const FILM_STAGES = [
  ['setup', 'Set up your tools'], ['studio-init', 'Create your studio'],
  ['film-breakdown', 'Break down the film'], ['reference-board', 'Approve references'],
  ['asset-passport', 'Create asset passports'], ['stress-test', 'Test and lock assets'],
  ['shot-prompt', 'Write shot prompts'],
];
export const STYLE_BOARDS = ['light', 'color', 'optics', 'camera movement', 'texture', 'cutting tempo', 'sound'];
export const STUDIO_FOLDERS = ['assets/characters', 'assets/locations', 'assets/props', 'prompts', 'generations', 'selects', 'edit', 'color', 'sound', 'master', 'docs'];
export const SHOT_LANES = [
  ['Identity', [['id', 'Scene / shot ID'], ['location', 'Location asset'], ['time', 'Time of day'], ['characters', 'Character assets'], ['props', 'Prop assets'], ['description', 'Description'], ['dialogue', 'Verbatim dialogue'], ['seconds', 'Running time'], ['complexity', 'Complexity']]],
  ['Direction', [['goal', 'Shot goal'], ['action', 'Task as a verb'], ['dramaturgy', 'Dramaturgy'], ['blocking', 'Blocking'], ['acting', 'Acting'], ['style', 'Style device']]],
  ['Camera / edit', [['size', 'Shot size'], ['movement', 'Camera movement'], ['lens', 'Lens'], ['angle', 'Angle'], ['cut', 'Cut type'], ['pace', 'Pace'], ['transition', 'Transition']]],
];
export const PROMPT_BLOCKS = ['Scene context', 'Active references', 'Location map', 'First-frame blocking', 'Format mode', 'Optics', 'Camera body', 'Action timing', 'Physics', 'Lighting', 'Audio', 'Character acting', 'Style prefix', 'Quality bar', 'Positive constraints'];
export const ACCEPTANCE_CHECKS = ['References match', 'Anatomy and surfaces are clean', 'Camera follows the card', 'Performance and lip-sync hold', 'Continuity matches adjacent shots', 'Palette matches'];
const present = v => typeof v === 'string' && v.trim().length > 0;
export const assetKey = a => `${a.tag}:v${a.version}`;
export const assetTags = value => String(value || '').split(',').map(s => s.trim()).filter(s => s && s !== 'none');
export const shotAssets = s => [...new Set([s.location, ...assetTags(s.characters), ...assetTags(s.props)].filter(present))];
export const validAssetKey = k => /^@[a-zA-Z][a-zA-Z0-9_]{0,39}:v[1-9]\d{0,3}$/.test(k);
export function assetType(film, key) {
  if(film.shots.some(s=>s.location===key)) return 'location';
  return film.shots.some(s=>assetTags(s.characters).includes(key))?'character':'prop';
}
export function emptyFilm() {
  return { schema: 1, name: '', stack: { image: '', video: '', imageAccess: 'Studio', videoAccess: 'Studio', seconds: '10', aspect: '16:9' },
    script: '', shots: [], boards: [], assets: [], prompts: [], attempts: [] };
}
export function shotIssues(s) {
  const issues = SHOT_LANES.flatMap(([, fields]) => fields.filter(([key]) => !present(s[key])).map(([, label]) => `${label} is missing.`));
  if (!(Number(s.seconds) >= 10 && Number(s.seconds) <= 15)) issues.push('A clip must last 10–15 seconds.');
  if (!s.oneAction) issues.push('Confirm that the clip contains one action.');
  if (!validAssetKey(s.location)) issues.push('Use an exact location tag and version, such as @room:v1.');
  if ([...assetTags(s.characters), ...assetTags(s.props)].some(k => !validAssetKey(k))) issues.push('Character and prop tags need an exact version. Use none for an empty list.');
  if (s.text && (!present(s.textPlacement) || !present(s.textContext))) issues.push('Give the separate text task its placement and context.');
  return issues;
}
export function boardIssues(b) {
  const refs = b.references.filter(r => r.kind === 'reference');
  const range = { character: [10, 20], location: [8, 15], prop: [3, 5], style: [1, 100] }[b.type];
  const issues = [];
  if (!range || refs.length < range[0] || refs.length > range[1]) issues.push(`${b.name}: needs ${range?.join('–') || 'valid'} references.`);
  if (b.references.some(r => !present(r.source) || !present(r.caption))) issues.push(`${b.name}: every reference needs its source and a precise caption.`);
  if (new Set(b.references.map(r => r.source.trim())).size !== b.references.length) issues.push(`${b.name}: reference sources must be distinct.`);
  if (b.decision !== 'approved') issues.push(`${b.name}: needs a written approval.`);
  return issues;
}
export function stageIssues(film, stage) {
  if (stage === 0) return [!present(film.stack.image) && 'Choose an image model.', !present(film.stack.video) && 'Choose a video model.',
    !(Number(film.stack.seconds) >= 10 && Number(film.stack.seconds) <= 15) && 'Choose a clip length of 10–15 seconds.'].filter(Boolean);
  if (stage === 1) return present(film.name) ? [] : ['Name your studio.'];
  if (stage === 2) return [!present(film.script) && 'Add the script, treatment or idea.', !film.shots.length && 'Add at least one shot.',
    ...film.shots.flatMap(s => shotIssues(s).map(i => `${s.id || 'Shot'}: ${i}`)),
    new Set(film.shots.map(s => s.id)).size !== film.shots.length && 'Shot IDs must be unique.'].filter(Boolean);
  const required = [...new Set(film.shots.flatMap(shotAssets))];
  if (stage === 3) return [...required.filter(k => !film.boards.some(b => b.name === k && b.type === assetType(film,k))).map(k => `Add a ${assetType(film,k)} reference board for ${k}.`),
    ...STYLE_BOARDS.filter(k => !film.boards.some(b => b.name === k && b.type === 'style')).map(k => `Add the ${k} style board.`), ...film.boards.flatMap(boardIssues)];
  if (stage === 4) return required.flatMap(k => {
    const a = film.assets.find(a => assetKey(a) === k);
    return !a ? [`Create the ${k} passport.`] : a.type!==assetType(film,k)||!present(a.descriptor) || !a.references.length || a.references.some(r => !present(r)) ? [`${k}: complete its type, descriptor and reference files.`] : [];
  });
  if (stage === 5) return required.filter(k => !isLocked(film, film.assets.find(a => assetKey(a) === k))).map(k => `${k} is draft. Pass its entire test matrix and record the lock decision.`);
  return film.shots.filter(s => !film.prompts.some(p => p.shot === s.id && p.context === promptContext(film, s))).map(s => `Write the current prompt for ${s.id}.`);
}
export function accessibleStage(film) {
  for (let i = 0; i < 7; i++) if (stageIssues(film, i).length) return i;
  return 6;
}
export function testMatrix(film, asset) {
  const key = assetKey(asset);
  const scenes = film.shots.filter(s => shotAssets(s).includes(key));
  const rows = Array.from({ length: asset.type === 'character' ? 10 : 5 }, (_, i) => {
    const s = scenes[i % scenes.length];
    return { id: `view-${i}`, angle: ['front', 'three-quarter', 'profile', 'back', 'close detail'][i % 5], size: i < 5 ? 'medium' : 'wide', shot: s?.id || '', light: s?.time || '', pair: '' };
  });
  for (const s of scenes) {
    rows.push({ id: `light-${s.id}`, angle: s.angle, size: s.size, shot: s.id, light: s.time, pair: '' });
    for (const pair of shotAssets(s).filter(k => k !== key)) rows.push({ id: `pair-${s.id}-${pair}`, angle: 'three-quarter', size: 'two-shot', shot: s.id, light: s.time, pair });
  }
  return rows;
}
export function lockContext(film, asset) {
  if (!asset) return '';
  return JSON.stringify({ descriptor: asset.descriptor, references: asset.references, type: asset.type,
    boards: film.boards, matrix: testMatrix(film, asset),
    pairings: film.assets.filter(a => testMatrix(film, asset).some(r => r.pair === assetKey(a))).map(a => [assetKey(a), a.descriptor, a.references]) });
}
export function isLocked(film, asset) {
  if (!asset || !asset.lock || asset.lock.context !== lockContext(film, asset)) return false;
  const rows=testMatrix(film,asset);
  return rows.every(row => asset.tests?.[row.id]?.verdict === 'pass' && present(asset.tests[row.id].result))
    && new Set(rows.map(r=>asset.tests[r.id].result.trim())).size===rows.length;
}
export function lockAsset(film, key) {
  if ([0, 1, 2, 3, 4].some(i => stageIssues(film, i).length)) throw new Error('Complete the breakdown, approved boards and passports before locking.');
  const asset = film.assets.find(a => assetKey(a) === key);
  if (!asset || !testMatrix(film, asset).every(r => asset.tests?.[r.id]?.verdict === 'pass' && present(asset.tests[r.id].result))) throw new Error('Every test needs an output reference and a pass. A miss cannot be averaged away.');
  if(new Set(testMatrix(film,asset).map(r=>asset.tests[r.id].result.trim())).size!==testMatrix(film,asset).length) throw new Error('Every test needs its own distinct output.');
  return { ...film, assets: film.assets.map(a => a === asset ? { ...a, lock: { context: lockContext(film, a), at: new Date().toISOString() } } : a) };
}
export function referenceSheet(asset) {
  return `${asset.descriptor}\nNeutral grey background. Five views of the same asset: front, three-quarter, profile, back and close detail. Identity, materials and the variant state match across every view. References: ${asset.references.join(', ')}.`;
}
export function testPrompt(film, asset, row) {
  const paired = film.assets.find(a => assetKey(a) === row.pair);
  return [asset.descriptor, `References: ${asset.references.join(', ')}.`, `${row.angle}, ${row.size}. Static image. Scene ${row.shot}, light: ${row.light}.`,
    paired?.descriptor, paired && `Paired references: ${paired.references.join(', ')}. Both identities match their references.`].filter(Boolean).join('\n');
}
export const PROMPT_DETAILS = [['map', 'Positions, distances in metres and camera axis'], ['camera', 'Camera height, support, path and stopping point'], ['timing', 'Action beats of 0.3–0.8 seconds'], ['physics', 'Persistent physical consequences'], ['lighting', 'Light sources and palette from the location passport'], ['audio', 'Ambience and in-frame sound'], ['palette', '60:30:10 dominant, secondary and accent colours'], ['quality', 'Reference match and quality requirements'], ['constraints', 'Visible positive constraints and the failure condition']];
export function promptContext(film, shot) {
  return JSON.stringify([film.stack, shot, film.boards, shotAssets(shot).map(k => {
    const a = film.assets.find(a => assetKey(a) === k);
    return a && [k, a.descriptor, a.references, a.lock];
  })]);
}
export function buildShotPrompt(film, shot, details) {
  for (let i = 0; i < 6; i++) if (stageIssues(film, i).length) throw new Error(stageIssues(film, i)[0]);
  if (PROMPT_DETAILS.some(([k]) => !present(details[k]))) throw new Error('Complete every prompt detail.');
  const assets = shotAssets(shot).map(k => film.assets.find(a => assetKey(a) === k));
  const characters = assetTags(shot.characters).length;
  const values = [
    `EXACT ${characters} CHARACTERS — NO DUPLICATES. ${shot.id}. ${shot.goal}. ${shot.action}. ${shot.description}`,
    assets.map(a => `${assetKey(a)}\n${a.descriptor}\nReference files: ${a.references.join(', ')}`).join('\n\n'),
    details.map, shot.blocking, `${film.stack.aspect}. ${film.stack.video}. ${film.stack.videoAccess}. ${shot.seconds} seconds.`,
    `${shot.lens}. Field of view changes on a hard cut.`, `${shot.angle}. ${shot.movement}. ${details.camera}`,
    details.timing, details.physics, details.lighting,
    `${details.audio}${shot.dialogue === 'none' ? '' : `\nDialogue, verbatim: ${shot.dialogue}`}`, shot.acting,
    `${shot.style}. ${details.palette}.`, details.quality, details.constraints,
  ];
  return PROMPT_BLOCKS.map((label, i) => `${i + 1}. ${label}\n${values[i]}`).join('\n\n');
}
export function nextPromptVersion(film, shot, content) {
  const headings=content.split('\n').filter(line=>/^\d+\. /.test(line));
  if(headings.length!==15||PROMPT_BLOCKS.some((title,i)=>headings[i]!==`${i+1}. ${title}`)) throw new Error('Preserve all fifteen prompt blocks in their original order.');
  const previous = film.prompts.filter(p => p.shot === shot.id);
  const last = previous.at(-1);
  if (last && !film.attempts.some(a => a.shot === shot.id && a.version === last.version)) throw new Error('Log the previous generation result and verdict before revising.');
  if (last && last.context === promptContext(film, shot)) {
    const before = last.content.split('\n'), after = content.split('\n');
    if (before.length !== after.length || before.filter((line, i) => line !== after[i]).length !== 1) throw new Error('Change exactly one line. Keep all other lines verbatim.');
    const descriptors = shotAssets(shot).map(k => film.assets.find(a => assetKey(a) === k).descriptor);
    if (descriptors.some(d => !content.includes(d))) throw new Error('Canonical descriptors must stay verbatim.');
    if (shot.dialogue !== 'none' && !content.includes(shot.dialogue)) throw new Error('Keep the supplied dialogue verbatim.');
  }
  const failed=film.attempts.filter(a=>a.shot===shot.id&&a.verdict==='rejected'&&previous.find(p=>p.version===a.version)?.context===promptContext(film,shot)).length;
  if (failed >= 15 && last?.context === promptContext(film, shot)) throw new Error('Fifteen failed attempts: simplify the shot card before trying again.');
  return { shot: shot.id, version: (last?.version || 0) + 1, content, context: promptContext(film, shot), at: new Date().toISOString() };
}
export function logFilmAttempt(film, prompt, entry) {
  if (!film.prompts.includes(prompt) || !present(entry.result) || !present(entry.changed)) throw new Error('Record the result and what changed.');
  if (film.attempts.some(a=>a.shot===prompt.shot&&a.version===prompt.version)) throw new Error('This prompt version already has a result. Create the next version before the next attempt.');
  if (!['accepted','rejected'].includes(entry.verdict)) throw new Error('Choose a verdict.');
  const shot=film.shots.find(s=>s.id===prompt.shot);
  if (!shot || prompt.context!==promptContext(film,shot) || [0,1,2,3,4,5].some(i=>stageIssues(film,i).length)) throw new Error('Rebuild the prompt from the current locked passports before recording an attempt.');
  if (entry.verdict==='accepted'&&!ACCEPTANCE_CHECKS.every(c=>entry.checks?.includes(c))) throw new Error('An accepted take needs all six quality checks.');
  return {...film,attempts:[...film.attempts,{shot:prompt.shot,version:prompt.version,result:entry.result,changed:entry.changed,verdict:entry.verdict,checks:entry.checks||[],at:new Date().toISOString()}]};
}
