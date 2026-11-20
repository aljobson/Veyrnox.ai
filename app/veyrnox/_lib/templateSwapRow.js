// The curated "Put yourself in" row (web /app and the phone home). Picked by fixed criteria, listed in the PR that added it:
// in TEMPLATE_SWAP_CLIPS, role "the main character" (one person), no car/brand/animal/duo scenes, not a withdrawn duplicate,
// one per scene family, the largest posters per category, plus the two ids proven on staging. Name, poster and ratio are copied
// from the template data (tests/templateSwapRow.test.mjs fails if they drift) so the row never imports the 2 MB template catalog.
// Whether a card shows is decided by the server: GET /api/catalog?template_swap_row=1 answers only the ids that are live.
// 2026-11-20: basketball-3, community-billboard-product-swap and community-stadium-ball-control left the row. A one-photo swap can drop the
// second person in the scene (seen on basketball-3, ADR-0351 amendment 12). They stay swappable by direct link; the registry is unchanged.
export const TEMPLATE_SWAP_ROW = Object.freeze([
  {"id":"community-storefront-hero-swap","name":"STOREFRONT HERO SWAP","poster":"/showcase/creator-community-storefront-hero-swap.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-broomstick-flight-swap","name":"BROOMSTICK FLIGHT SWAP","poster":"/showcase/viral-community-broomstick-flight-swap.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-summit-lounge-style","name":"SUMMIT LOUNGE STYLE","poster":"/showcase/creator-community-summit-lounge-style.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-urban-fashion-stroll","name":"URBAN FASHION STROLL","poster":"/showcase/viral-community-urban-fashion-stroll.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-suit-walk","name":"SUIT WALK","poster":"/showcase/viral-community-suit-walk.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-street-vendor-swap","name":"STREET VENDOR SWAP","poster":"/showcase/creator-community-street-vendor-swap.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-kitchen-fish-slice","name":"KITCHEN FISH SLICE","poster":"/showcase/creator-community-kitchen-fish-slice.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-brooklyn-bridge-groove","name":"BROOKLYN BRIDGE GROOVE","poster":"/showcase/creator-community-brooklyn-bridge-groove.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-nightclub-dj-set","name":"NIGHTCLUB DJ SET","poster":"/showcase/creator-community-nightclub-dj-set.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-kitchen-dance-swap","name":"KITCHEN DANCE SWAP","poster":"/showcase/creator-community-kitchen-dance-swap.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-garden-path-tea","name":"GARDEN PATH TEA","poster":"/showcase/creator-community-garden-path-tea.jpg","aspectRatio":"600 / 1066"},
  {"id":"community-apocalypse-lounge","name":"APOCALYPSE LOUNGE","poster":"/showcase/creator-community-apocalypse-lounge.jpg","aspectRatio":"480 / 854"},
  {"id":"community-natural-face-swap","name":"NATURAL FACE SWAP","poster":"/showcase/creator-community-natural-face-swap.jpg","aspectRatio":"600 / 1062"},
].map(Object.freeze));
