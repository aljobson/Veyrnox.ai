// Compact editor commands retain their full accessible names and tooltips.
const paths={
    Undo:'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',Redo:'m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
    Duplicate:'M9 9h12v12H9zM4 15V4h11',Split:'m4 4 16 16M4 20 20 4M8 12l4-4',Delete:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7m4-7v7',
    Copy:'M9 9h12v12H9zM4 15V4h11','Paste at playhead':'M8 4H5v17h14V4h-3M8 3h8v4H8zM9 13h6m-6 4h6',
    Group:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7zM7 10v4m10-4v4M10 7h4m-4 10h4',
    Ungroup:'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
};
export function CommandIcon({name}){return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;}
