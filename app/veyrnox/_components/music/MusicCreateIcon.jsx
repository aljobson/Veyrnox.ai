export function MusicCreateIcon({ name, className = 'h-5 w-5' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === 'describe' && <><path d="M5 4.5h14v15H5z"/><path d="M8 8h8M8 12h8M8 16h5"/></>}
      {name === 'lyrics' && <><path d="M9 18V6l9-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="15" cy="16" r="3"/></>}
      {name === 'voice' && <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10a6 6 0 0 0 12 0M12 16v5M9 21h6"/></>}
      {name === 'genre' && <><path d="M4 12h2l2-6 3 12 3-9 2 3h4"/></>}
      {name === 'mood' && <><circle cx="12" cy="12" r="8"/><path d="M9 10h.01M15 10h.01M8.5 14.5c2.2 2 4.8 2 7 0"/></>}
      {name === 'tempo' && <><path d="M5 18a8 8 0 1 1 14 0"/><path d="m12 14 4-4M8 18h8"/></>}
      {name === 'structure' && <><path d="M5 5h5v5H5zM14 14h5v5h-5z"/><path d="M10 7.5h4a3 3 0 0 1 3 3V14M14 16.5h-4a3 3 0 0 1-3-3V10"/></>}
      {name === 'chevron' && <path d="m7 9 5 5 5-5"/>}
    </svg>
  );
}
