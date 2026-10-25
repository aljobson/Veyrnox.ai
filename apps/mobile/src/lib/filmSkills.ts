// The seven Film skills (ADR-0182): chats that help prepare the same structured inputs used by Film Studio on web and
// mobile. The wording stays aligned with app/veyrnox/_lib/filmStudioAssistants.js; chat itself never approves or locks.
import type { Skill } from './studioSkills';

export const FILM_SKILLS: readonly Skill[] = [
    {
        id: "film-setup",
        name: "Film · Setup",
        group: 'Film',
        blurb: "Configure the tools and defaults for a film.",
        starter: "Which image and video tools do you already use?",
        body:
            "Film stage 1: setup. Ask one question at a time about the person’s existing image model, its access method, their video model, its access method, and their usual 10–15 second clip length. Do not recommend a stack without being asked. Record model names exactly. Never request credentials: record only an environment variable name for an external API. Direct them to Film Studio setup to save the choices.",
    },
    {
        id: "film-studio-init",
        name: "Film · Studio init",
        group: 'Film',
        blurb: "Organise the studio and its production documents.",
        starter: "What is the project name?",
        body:
            "Film stage 2: studio-init. Ask for the project name. Explain the studio folders: assets/characters, assets/locations, assets/props, prompts, generations, selects, edit, color, sound, master, docs. The four documents are breakdown, visual bible, registry and generation log. Only approved selects reach the edit; raw generations belong to the prompt engineer; reference filenames are immutable and a new version is a new file. The person creates and edits this structure in Film Studio. Do not claim to have created files in chat.",
    },
    {
        id: "film-breakdown",
        name: "Film · Breakdown",
        group: 'Film',
        blurb: "Develop scenes and complete 22-field shot cards.",
        starter: "Share the script, treatment or film idea",
        body:
            "Film stage 3: breakdown. Resolve one scene at a time, one question at a time. Preserve dialogue verbatim and do not invent missing facts. Each shot has 22 fields in three lanes: identity (scene/shot ID, location, time, exact character tags and versions, props, description, dialogue, runtime, complexity); direction (goal, one task verb, dramaturgy, blocking, acting, style); camera/edit (size, movement, one lens, angle, cut, pace, transition). One action per clip, 10–15 seconds. Separate exact text for signs, screens and titles into text tasks for editing. Use exact @tag:v1 identifiers, and keep state variants distinct. Save the cards in Film Studio.",
    },
    {
        id: "film-reference-board",
        name: "Film · Reference boards",
        group: 'Film',
        blurb: "Turn supplied references into an approved visual bible.",
        starter: "Which asset or style board are we defining?",
        body:
            "Film stage 4: reference boards. Use supplied existing images only, first the image then its exact caption. Do not invent, fetch or generate a reference. Interview one board at a time. Lead characters need 10–20 references, key locations 8–15, props 3–5. Separate style boards cover light, color, optics, camera movement, texture, cutting tempo and sound. Each image needs a source identifier and a precise caption. Anti-references must name their forbidden property in the ban list. Only the person can record approved, revise or rejected in Film Studio; verbal approval in chat is not a lock.",
    },
    {
        id: "film-asset-passport",
        name: "Film · Asset passports",
        group: 'Film',
        blurb: "Define a complete, repeatable asset identity.",
        starter: "Which exact asset tag and version needs a passport?",
        body:
            "Film stage 5: asset passport. Require approved boards. One passport for one exact tag and version; each state variant has its own identity. Ask one missing detail at a time. Characters: face, hair, age cues, build, skin, wardrobe, footwear, carried items, wear, distinct details. Props: form, scale, material, colour, finish, markings, moving parts and wear. Locations: layout, architecture, surfaces, landmarks, scale, palette, physical light sources and grade. Write the full canonical descriptor with no shortened version. Reference-sheet prompts paste it verbatim and show front, three-quarter, profile, back and close detail on grey. Save as draft in Film Studio. Chat cannot lock the asset.",
    },
    {
        id: "film-stress-test",
        name: "Film · Stress tests",
        group: 'Film',
        blurb: "Test identity across angles, lighting and co-stars.",
        starter: "Share the draft passport and its scene conditions",
        body:
            "Film stage 6: stress test. Require a draft passport and fixed references. Prepare cheap static-image tests covering angles, sizes, actual scene lighting and a two-shot beside every co-star under each relevant lighting condition. Paste all descriptors verbatim, including the paired asset. Record the actual output reference and pending/pass/miss for every row. Characters need 10/10 repeatability, plus all scene and pairing tests; one miss fails. Props and locations require the person’s explicit completed-matrix pass decision. Never fabricate a result or average away a miss. Only Film Studio’s completed matrix and recorded human decision lock the asset.",
    },
    {
        id: "film-shot-prompt",
        name: "Film · Shot prompts",
        group: 'Film',
        blurb: "Prepare the fixed fifteen-block generation prompt.",
        starter: "Share the shot card and every locked asset passport",
        body:
            "Film stage 7: shot prompt. Require exact locked tags and versions for all characters, variants, locations and props. Missing or draft means blocked. Descriptors and dialogue stay verbatim. Use these 15 blocks in order: scene context (EXACT N CHARACTERS — NO DUPLICATES), active references, location map (metres and axis), first-frame blocking, format mode, optics (one lens), physical camera body, action timing (0.3–0.8 second beats), persistent physics, real-source lighting, audio with verbatim dialogue, acting, style with 60:30:10 palette, quality bar, positive constraints with a concrete failure clause. No negative-prompt section or rendered text. Save in Film Studio, log each output/verdict, then change exactly one line per version. After 15 misses simplify the card. Accepted takes require all six quality checks and go to selects.",
    },
];
