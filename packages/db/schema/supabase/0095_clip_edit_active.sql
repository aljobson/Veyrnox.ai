-- Clip Editor, slice 3 (docs/editor/PRD.md §8): turn the clip-edit row on.
--
-- ACTIVE so the owner can run the first live edit from the Library, the
-- same way 0093 opened Auto Short. The edit sheet only appears in browsers
-- with localStorage.veyrnox_editor = '1' (slice 2), and Create, the landing
-- shelf and site search never list the row. /api/catalog does list it, so
-- a direct API call with the caller's own Assets is a real, refundable
-- purchase.
--
-- ADR-0011: the three fal endpoints the editor calls (trim-video,
-- merge-videos, merge-audio-video) were called live in slice 0 (PRD §9).
-- The price, 1 credit per started 5 s of output, was set in 0092 and clears
-- the ADR-0014 floor in every case (PRD §6).
--
-- Rollback is the mirror of this file (active = false), not an edit to it.

UPDATE public.model_catalog
SET active = true
WHERE id = 'clip-edit' AND active = false;
