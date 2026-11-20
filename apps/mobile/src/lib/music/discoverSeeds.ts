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
    },
    {
        "id": "midnight-amp",
        "title": "Midnight Amp",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Rock",
        "bpm": 118,
        "musicalKey": "F-sharp minor",
        "duration": "0:12",
        "recipe": "Driving modern rock instrumental at 118 BPM in F-sharp minor, live-feeling drums, picked electric bass, wide guitars and an anthemic hook, and a distinct midnight amp arrangement built as a fresh original variation"
    },
    {
        "id": "open-road-echo",
        "title": "Open Road Echo",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Rock",
        "bpm": 120,
        "musicalKey": "D minor",
        "duration": "0:12",
        "recipe": "Driving modern rock instrumental at 120 BPM in D minor, live-feeling drums, picked electric bass, wide guitars and an anthemic hook, and a distinct open road echo arrangement built as a fresh original variation"
    },
    {
        "id": "signal-fire",
        "title": "Signal Fire",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Rock",
        "bpm": 122,
        "musicalKey": "G minor",
        "duration": "0:12",
        "recipe": "Driving modern rock instrumental at 122 BPM in G minor, live-feeling drums, picked electric bass, wide guitars and an anthemic hook, and a distinct signal fire arrangement built as a fresh original variation"
    },
    {
        "id": "glass-horizon",
        "title": "Glass Horizon",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Jazz",
        "bpm": 100,
        "musicalKey": "C minor",
        "duration": "0:12",
        "recipe": "Contemporary jazz instrumental at 100 BPM in C minor, brushed syncopated drums, upright bass movement, electric piano voicings and restrained horn answers, and a distinct glass horizon arrangement built as a fresh original variation"
    },
    {
        "id": "blue-room-steps",
        "title": "Blue Room Steps",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Jazz",
        "bpm": 102,
        "musicalKey": "F minor",
        "duration": "0:12",
        "recipe": "Contemporary jazz instrumental at 102 BPM in F minor, brushed syncopated drums, upright bass movement, electric piano voicings and restrained horn answers, and a distinct blue room steps arrangement built as a fresh original variation"
    },
    {
        "id": "after-five",
        "title": "After Five",
        "creator": "Veyrnox Sessions",
        "section": "For you",
        "mood": "Jazz",
        "bpm": 104,
        "musicalKey": "D major",
        "duration": "0:12",
        "recipe": "Contemporary jazz instrumental at 104 BPM in D major, brushed syncopated drums, upright bass movement, electric piano voicings and restrained horn answers, and a distinct after five arrangement built as a fresh original variation"
    }
] as const;
export type DiscoverSeed = typeof DISCOVER_SEEDS[number];
export function buildSamplePrompt(seed: Pick<DiscoverSeed, 'id'>, direction = '') {
    const canonical = DISCOVER_SEEDS.find(s => s.id === seed.id);
    if (!canonical) return '';
    const next = direction.trim().slice(0, 200);
    return (canonical.recipe + (next ? '. New direction: ' + next : '. Create a fresh instrumental variation with a distinct melody and arrangement.')).slice(0, 500);
}
