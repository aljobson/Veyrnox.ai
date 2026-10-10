'use client';
import { useEffect } from 'react';

// Lands an arrival on the section its address names (/#faq, /#models).
// The home page is rendered per request and arrives behind its loading
// state, so the section is often not on the page yet when the browser looks
// for it: measured on the live site, two whole-page loads of /#faq in five
// stayed at the top. This mounts with the sections, so they are there.
// Only from the very top: a reader who has already scrolled, and a Back that
// put them where they were, are left alone. A link pressed on the page itself
// is the browser's to follow and never comes through here.
export function SectionJump() {
  useEffect(() => {
    if (window.scrollY > 0) return;
    let id = '';
    try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
    // 'instant', not the page's smooth scroll: nobody asked to watch 5,000px go by.
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant' });
  }, []);
  return null;
}
