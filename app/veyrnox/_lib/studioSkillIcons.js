// Every built-in Studio skill has a stable visual identity. These paths are
// original Veyrnox line icons, not marks copied from a model vendor or another
// skills library.
export const STUDIO_SKILL_ICONS = {
  'prompt-writer': {
    color: '#55f2d6',
    path: 'M4 20 16.7 7.3M14.5 5.5l4 4M5 4v3M3.5 5.5h3M18 15v5M15.5 17.5h5',
  },
  'model-picker': {
    color: '#91e8ff',
    path: 'M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4M14 3v6M7 9v6M12 15v6',
  },
  'fix-my-photo': {
    color: '#b4a1ff',
    path: 'M4 5.5h10v13H4zM5 16l3-3 2 2 2.5-2.5 1.5 1.5M17 4v5M14.5 6.5h5M17.8 14.2l.8 1.6 1.7.8-1.7.8-.8 1.6-.8-1.6-1.7-.8 1.7-.8z',
  },
  'edit-with-words': {
    color: '#d59bff',
    path: 'M4 6h9M4 10h7M4 14h5M13.5 17.5 18 13l3 3-4.5 4.5-4 1zM17 14l3 3',
  },
  'bring-to-life': {
    color: '#77f0a7',
    path: 'M9 7.5v9l7-4.5zM4 6 2.5 8M4 18l-1.5-2M20 6l1.5 2M20 18l1.5-2M6 3.5 8 2M18 3.5 16 2',
  },
  'add-sound': {
    color: '#ffb66e',
    path: 'M3 12h3l3-4v8l3-8v8l3-6v4l3-2h3',
  },
  storyboard: {
    color: '#ffd66e',
    path: 'M3.5 5h17v14h-17zM9 5v14M15 5v14M3.5 10h17M3.5 15h17',
  },
  'oddling-continuity': {
    color: '#f1c75b',
    path: 'M7 8a5 5 0 0 1 10 0v3a5 5 0 0 1-10 0zM9 9h.01M15 9h.01M10 13c1.2 1 2.8 1 4 0M5 20c1-3 13-3 14 0',
  },
  'fix-my-prompt': {
    color: '#69e9c6',
    path: 'M4 6h11M4 10h8M4 14h5M14 15l2 2 4-5M17.5 4.5v3M16 6h3',
  },
  'film-setup': {
    color: '#ff8f79',
    path: 'M4 7h6M14 7h6M4 12h2M10 12h10M4 17h9M17 17h3M10 4v6M6 9v6M13 14v6',
  },
  'film-studio-init': {
    color: '#ff9f75',
    path: 'M3 6h7l2 2h9v11H3zM8 12h8M8 16h5',
  },
  'film-breakdown': {
    color: '#ffb36b',
    path: 'M4 8h16v12H4zM4 8l3-4 3 4 3-4 3 4 3-4M8 13h8M8 16h5',
  },
  'film-reference-board': {
    color: '#ffca73',
    path: 'M6 4h14v12H6zM4 8H2v12h14v-2M8 14l3-3 2 2 2-2 3 3M15.5 7.5h.01',
  },
  'film-asset-passport': {
    color: '#f7df83',
    path: 'M5 3h14v18H5zM9 8a2 2 0 1 0 4 0 2 2 0 1 0-4 0M8 14c1-2 5-2 6 0M16 8h1M16 12h1M8 17h9',
  },
  'film-stress-test': {
    color: '#ff8b91',
    path: 'M3 12h4l2-5 3 10 2-5h3M15 18l2 2 4-5M17.5 4.5a7.5 7.5 0 0 0-12 3',
  },
  'film-shot-prompt': {
    color: '#ff7f73',
    path: 'M4 7h4l1.5-2h5L16 7h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 1 0 0-6M12 8V6M12 20v-2M8 14H6M18 14h-2',
  },
};

export function studioSkillIcon(id) {
  return STUDIO_SKILL_ICONS[id] || null;
}
