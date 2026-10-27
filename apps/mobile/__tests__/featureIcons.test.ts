// Every Tools task, Face filter and Studio skill shows its own icon, and every icon file exists.
import fs from 'fs';
import path from 'path';
import { FACE_IDS } from '../src/lib/faceFilters';
import { faceIcon, skillIcon, toolIcon } from '../src/lib/featureIcons';
import { MENU_ICONS } from '../src/lib/menuIcons';
import { SKILLS } from '../src/lib/studioSkills';
import { TOOL_TASKS } from '../src/lib/toolDirectory';

test('each tool task has its own icon, not the fallback', () => {
    const icons = TOOL_TASKS.map((task) => toolIcon(task.key).icon);
    expect(icons).not.toContain('squares');
    expect(new Set(icons).size).toBe(icons.length);
});

test('each face filter and Studio skill has a named icon', () => {
    for (const id of FACE_IDS) expect(faceIcon(id).icon).not.toBe('smiley');
    for (const skill of SKILLS) expect(skillIcon(skill.id, skill.group).icon).not.toBe('chat');
});

test('every icon used is registered', () => {
    const used = [...TOOL_TASKS.map((t) => toolIcon(t.key)), ...FACE_IDS.map(faceIcon), ...SKILLS.map((s) => skillIcon(s.id, s.group))];
    for (const { icon } of used) expect(MENU_ICONS[icon]).toBeDefined();
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/menuIcons.ts'), 'utf8');
    for (const [, file] of source.matchAll(/assets\/icons\/([\w-]+\.png)/g)) expect(fs.existsSync(path.join(__dirname, '../assets/icons', file))).toBe(true);
});
