import { skillById } from './studioSkills.js';

// Guided paths through existing, working Veyrnox tools. A workflow never runs
// generations in the background: each step opens a skill or the Film Studio and
// the person remains in control of every charged action.
export const STUDIO_WORKFLOWS = [
  {
    id: 'viral-short',
    name: 'Viral short',
    blurb: 'Shape a hook, plan the beats, animate the hero shot and finish with sound.',
    outcome: 'A vertical short plan with generation-ready prompts, motion and audio direction.',
    accent: '#55f2d6',
    path: 'M4 18V8l6-4v10l5-3v7M3 20h18M18 5v5M15.5 7.5h5',
    steps: ['prompt-writer', 'storyboard', 'bring-to-life', 'add-sound'],
  },
  {
    id: 'product-ad',
    name: 'Product ad',
    blurb: 'Polish a product image, build a hero frame and turn it into a social-ready clip.',
    outcome: 'A clean product visual plus a concise ad shot and matching sound direction.',
    accent: '#b99aff',
    path: 'M5 8.5 12 5l7 3.5v8L12 20l-7-3.5zM5 8.5l7 3.5 7-3.5M12 12v8M16.5 3.5v3M15 5h3',
    steps: ['fix-my-photo', 'edit-with-words', 'bring-to-life', 'add-sound'],
  },
  {
    id: 'photo-to-motion',
    name: 'Photo to motion',
    blurb: 'Repair a source image, direct one precise change and animate it cleanly.',
    outcome: 'A prepared source image and a controlled image-to-video prompt.',
    accent: '#91e8ff',
    path: 'M4 5h11v14H4zM5 16l3-3 2 2 3-3 2 2M18 8v8M16 14l2 2 2-2',
    steps: ['fix-my-photo', 'edit-with-words', 'bring-to-life'],
  },
  {
    id: 'consistent-film',
    name: 'Consistent film',
    blurb: 'Move from setup and story breakdown to locked assets and production-ready shots.',
    outcome: 'A structured film workspace with repeatable characters, references and shot prompts.',
    accent: '#ff9678',
    path: 'M4 8h16v12H4zM4 8l3-4 3 4 3-4 3 4 3-4M8 13h8M8 16h5',
    steps: ['film-setup', 'film-studio-init', 'film-breakdown', 'film-reference-board', 'film-asset-passport', 'film-stress-test', 'film-shot-prompt'],
    href: '/app/film-studio',
  },
  {
    id: 'oddling-series',
    name: 'Oddling series',
    blurb: 'Lock the character passport, shape the next story and prepare matching portrait or motion prompts.',
    outcome: 'A repeatable Oddling story with the same identity, show, visual theme and scene state in every draft.',
    accent: '#f1c75b',
    path: 'M7 8a5 5 0 0 1 10 0v3a5 5 0 0 1-10 0zM9 9h.01M15 9h.01M10 13c1.2 1 2.8 1 4 0M5 20c1-3 13-3 14 0',
    steps: ['oddling-continuity', 'storyboard', 'prompt-writer', 'bring-to-life'],
    href: '/app/oddlings',
  },
];

export function workflowById(id) {
  return STUDIO_WORKFLOWS.find((workflow) => workflow.id === id) || null;
}

export function workflowSteps(workflow) {
  return (workflow?.steps || []).map(skillById).filter(Boolean);
}

export function workflowStartHref(workflow) {
  if (!workflow) return '/app/skills';
  if (workflow.href) return workflow.href;
  const steps = workflowSteps(workflow).slice(0, 4);
  return steps.length ? `/app/chat?${steps.map((step) => `skill=${encodeURIComponent(step.id)}`).join('&')}` : '/app/skills';
}
