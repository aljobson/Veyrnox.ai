// First-party listed samples; verified against lib/musicDiscover.js by the drift test. No runtime web import.
export const DISCOVER_SEEDS = [
    {
        "id": "neon-rain",
        "title": "Neon Rain",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Hip-hop",
        "bpm": 84,
        "musicalKey": "C minor",
        "duration": "0:12",
        "recipe": "Head-nod hip-hop instrumental at 84 BPM in C minor, crisp pocket drums, warm sub bass, chopped keys and vinyl-soft melodic fragments, and a distinct neon rain arrangement built as a fresh original variation"
    },
    {
        "id": "pocket-theory",
        "title": "Pocket Theory",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Hip-hop",
        "bpm": 86,
        "musicalKey": "F minor",
        "duration": "0:12",
        "recipe": "Head-nod hip-hop instrumental at 86 BPM in F minor, crisp pocket drums, warm sub bass, chopped keys and vinyl-soft melodic fragments, and a distinct pocket theory arrangement built as a fresh original variation"
    },
    {
        "id": "eastbound-static",
        "title": "Eastbound Static",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Hip-hop",
        "bpm": 88,
        "musicalKey": "D major",
        "duration": "0:12",
        "recipe": "Head-nod hip-hop instrumental at 88 BPM in D major, crisp pocket drums, warm sub bass, chopped keys and vinyl-soft melodic fragments, and a distinct eastbound static arrangement built as a fresh original variation"
    },
    {
        "id": "low-key-cinema",
        "title": "Low Key Cinema",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Hip-hop",
        "bpm": 90,
        "musicalKey": "E minor",
        "duration": "0:12",
        "recipe": "Head-nod hip-hop instrumental at 90 BPM in E minor, crisp pocket drums, warm sub bass, chopped keys and vinyl-soft melodic fragments, and a distinct low key cinema arrangement built as a fresh original variation"
    },
    {
        "id": "corner-light",
        "title": "Corner Light",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Hip-hop",
        "bpm": 92,
        "musicalKey": "A minor",
        "duration": "0:12",
        "recipe": "Head-nod hip-hop instrumental at 92 BPM in A minor, crisp pocket drums, warm sub bass, chopped keys and vinyl-soft melodic fragments, and a distinct corner light arrangement built as a fresh original variation"
    },
    {
        "id": "velvet-circuit",
        "title": "Velvet Circuit",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Rock",
        "bpm": 114,
        "musicalKey": "C-sharp minor",
        "duration": "0:12",
        "recipe": "Driving modern rock instrumental at 114 BPM in C-sharp minor, live-feeling drums, picked electric bass, wide guitars and an anthemic hook, and a distinct velvet circuit arrangement built as a fresh original variation"
    },
    {
        "id": "iron-harbour",
        "title": "Iron Harbour",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Rock",
        "bpm": 116,
        "musicalKey": "E-flat major",
        "duration": "0:12",
        "recipe": "Driving modern rock instrumental at 116 BPM in E-flat major, live-feeling drums, picked electric bass, wide guitars and an anthemic hook, and a distinct iron harbour arrangement built as a fresh original variation"
    }
] as const;
export type DiscoverSeed = typeof DISCOVER_SEEDS[number];
export function buildSamplePrompt(seed: Pick<DiscoverSeed, 'id'>, direction = '') {
    const canonical = DISCOVER_SEEDS.find(s => s.id === seed.id);
    if (!canonical) return '';
    const next = direction.trim().slice(0, 200);
    return (canonical.recipe + (next ? '. New direction: ' + next : '. Create a fresh instrumental variation with a distinct melody and arrangement.')).slice(0, 500);
}
