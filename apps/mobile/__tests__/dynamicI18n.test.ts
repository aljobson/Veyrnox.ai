import { CATALOGS, createTranslator, startupLocale, setLocaleFromDevice } from '../src/lib/i18n';
import { SKILL_GROUPS } from '../src/lib/studioSkills';
import { CREATOR_ANSWERS } from '../src/lib/creatorAnswers';
import { creatorCardName } from '../src/lib/creatorCardLabels';
import { archetypeName } from '../src/lib/creatorArchetype';
import en from '../src/lib/i18n/messages/en';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs'), path = require('path'), ts = require('typescript');
// Fixed id domains for the dynamic t() families in production source. New families require a fixture;
// these are input ids, deliberately independent of translated output and the current catalog contents.
const domains: Record<string, readonly string[]> = {
    "publishParity.youtube.{}": ["private", "unlisted", "public"],
    "ads.mode.{}": ["standalone", "boost"],
    "ads.objective.{}": ["awareness", "traffic", "engagement", "leads", "sales"],
    "ads.status.{}": ["draft", "paused", "active", "completed"],
    "appearance.{}": ["mint", "iris", "sky", "rose", "mono", "studio", "editorial", "technical", "s", "m", "l", "xl", "firstCreation", "firstVideo", "afterOnboarding"],
    "approvals.policy.{}": ["any", "all"],
    "publishDepth.analytics.{}": ["conversations", "received", "sent", "failed", "read_actions", "median"],
    "publishDepth.reply.{}": ["anyway", "discard"],
    "publishDepth.reply.{}Body": ["anyway", "discard"],
    "publishDepth.reply.{}Title": ["anyway", "discard"],
    "brand.problem.{}": ["name", "palette", "fonts", "size"],
    "chat.make.kind.{}": ["image", "video", "audio"],
    "chat.skills.group.{}": ["Make", "Edit", "Plan", "Film"],
    "cinemaBrowse.cat.{}": ["romance", "drama", "thriller", "comedy", "horror", "sci-fi", "fantasy", "action", "mystery", "documentary", "animation", "kids"],
    "cinemaCreator.analytics.{}": ["viewers", "completions", "voters", "sharers", "commenters"],
    "cinemaCreator.status.{}": ["pending", "approved", "rejected"],
    "cinemaSocial.empty.{}": ["saved", "creator", "series", "winners"],
    "cinemaSocial.following.{}": ["creator", "series"],
    "cinemaSocial.myVote.{}": ["qualified", "under_review", "rejected"],
    "cinemaSocial.remove.{}": ["saved", "creator", "series"],
    "cinemaSocial.removeShort.{}": ["saved", "creator", "series"],
    "cinemaUpload.disclosure.{}": ["generated_video", "generated_voice", "generated_music", "synthetic_people", "face_replacement", "cloned_voice", "generated_script", "manipulated_real_world_footage"],
    "cinemaUpload.state.{}": ["DRAFT", "UNDER_REVIEW", "PUBLISHED", "SUSPENDED", "other"],
    "cinemaUpload.{}": ["title", "synopsis", "language"],
    "comments.cat.{}": ["spam", "abuse", "privacy", "rights", "other"],
    "commerce.status.{}": ["draft", "active", "archived"],
    "compose.youtube.{}": ["private", "unlisted", "public"],
    "contacts.status.{}": ["unknown", "subscribed", "unsubscribed"],
    "create.goal.{}": ["image", "video", "audio", "all"],
    "create.tier.{}": ["all", "low", "medium", "high"],
    "dev.logs.s.{}": ["all", "success", "error", "pending"],
    "dev.problem.{}": ["label", "scopes", "days", "url", "events"],
    "dev.tab.{}": ["keys", "hooks", "logs"],
    "draw.color.{}": ["yellow", "red", "white", "cyan"],
    "draw.size.{}": ["small", "medium", "large"],
    "draw.tool.{}": ["pen", "box", "erase"],
    "draw.{}": ["moveLeft", "moveRight", "moveUp", "moveDown"],
    "edit.problem.{}": ["no_clips", "too_many", "unknown_length", "bad_range", "too_long", "nothing_to_do", "audio_offset"],
    "explore.type.{}": ["all", "image", "video", "audio"],
    "faceFilters.{}": ["face-retouch", "face-enhance", "face-relight", "face-makeup", "face-age", "before", "after", "makeup_style", "intensity", "natural", "glamorous", "smoky_eyes", "bold_lips", "no_makeup", "remove_makeup", "dramatic", "bridal", "professional", "korean_style", "artistic", "light", "medium", "heavy"],
    "inbox.kind.{}": ["any", "message", "comment", "review"],
    "inbox.state.{}": ["unresolved", "unread", "resolved", "all"],
    "job.{}": ["queued", "running", "succeeded", "failed"],
    "language.creatorAdjective.{}": ["0", "1", "2"],
    "language.creatorNoun.{}": ["fox", "owl", "octopus", "jellyfish", "other"],
    "library.state.{}": ["all", "succeeded", "running", "queued", "failed"],
    "library.status.{}": ["ready", "creating", "queued", "failed", "held"],
    "library.type.{}": ["all", "image", "video", "audio", "favourites"],
    "library.view.{}": ["grid", "list"],
    "libsrc.kind.{}": ["image", "video", "audio"],
    "oddlingsProjects.{}": ["saved", "full", "unavailable", "busy", "rejected", "conflict", "gone", "other", "orphanLost"],
    "publishHome.group.{}": ["work", "engage", "grow", "manage"],
    "publishHome.group.{}.lead": ["work", "engage", "grow", "manage"],
    "publishUploads.{}{}": ["select|Video", "select|Image", "remove|Video", "remove|Image"],
    "publishWorkflows.kind.{}": ["message", "comment", "review", "any", "unknown"],
    "publishWorkflows.match.{}": ["contains", "exact", "unknown"],
    "publishWorkflows.tier.{}": ["free", "publish"],
    "reports.cadence.{}": ["weekly", "monthly"],
    "reports.format.{}": ["pdf", "pptx"],
    "smartlink.theme.{}": ["midnight", "light", "sunset"],
    "stem.{}": ["vocals", "drums", "bass", "other", "guitar", "piano"],
    "unlock.plan.{}": ["week", "month", "year"],
    "unlock.{}.body": ["calendar", "analytics", "inbox", "ads", "commerce"],
    "unlock.{}.title": ["calendar", "analytics", "inbox", "ads", "commerce"],
    "vibe.chaos.{}": ["0", "1", "2", "3", "4"],
    "vibe.goal.{}": ["sell", "story", "music_video", "meme", "character", "bedtime"],
    "vibe.voice.{}": ["hype", "calm", "straight"],
    "vibe.voice.{}.sub": ["hype", "calm", "straight"],
    "vibe.{}.title": ["goal", "look", "pace", "chaos", "destination", "audience", "voice"],
    "vibe.{}.{}": ["look|neon_rain", "look|sunlit_kitchen", "look|retro_vhs", "look|dream_anime", "look|glossy_product", "look|doc_grit", "pace|fox", "pace|owl", "pace|octopus", "pace|jellyfish", "destination|tiktok", "destination|reels", "destination|youtube", "destination|cinema", "destination|roll", "audience|me", "audience|audience", "audience|customers", "audience|kids", "audience|nobody_yet"],
    "vibe.{}.{}.sub": ["pace|fox", "pace|owl", "pace|octopus", "pace|jellyfish"],
    "videoAgent.step{}.body": ["1", "2", "3"],
    "videoAgent.step{}.title": ["1", "2", "3"],
    "videoAgent.tip{}": ["1", "2", "3", "4"],
};
const expand = (family: string, ids: string) => { const parts = ids.split('|'); return family.replace(/\{\}/g, () => parts.shift()!); };
const es = createTranslator(startupLocale(null, ['es-MX'], ['en', 'es']), CATALOGS);
test.each(Object.entries(domains))('all ids in %s resolve when Spanish is active', (family, ids) => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
        const key = expand(family, id);
        expect(Object.hasOwn(en, key)).toBe(true);
        expect(es.t(key)).not.toBe(key);
    }
});
test('source dynamic families have fixtures and never derive keys from display text', () => {
    const root = path.join(__dirname, '../src');
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((f: any) => f.isDirectory() ? files(path.join(dir, f.name)) : /\.tsx?$/.test(f.name) ? [path.join(dir, f.name)] : []);
    const errors: string[] = [];
    for (const file of files(root)) {
        const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const visit = (node: any) => {
            if (ts.isCallExpression(node) && node.expression.getText(ast) === 't' && node.arguments[0] && ts.isTemplateExpression(node.arguments[0])) {
                const key = node.arguments[0];
                const family = key.head.text + key.templateSpans.map((span: any) => '{}' + span.literal.text).join('');
                if (!domains[family]) errors.push(`${file}: missing fixture ${family}`);
                for (const span of key.templateSpans) if (/\b(?:t|displayLabel)\s*\(|\.name\b|\.split\s*\(/.test(span.expression.getText(ast))) errors.push(`${file}: display text in ${family}`);
            }
            ts.forEachChild(node, visit);
        };
        visit(ast);
    }
    expect(errors).toEqual([]);
});
test('skill and Vibe domains cover every source id, including all creator-name combinations', () => {
    expect(domains['chat.skills.group.{}']).toEqual(SKILL_GROUPS);
    for (const [field, ids] of Object.entries(CREATOR_ANSWERS)) for (const id of ids) {
        expect(es.t(`vibe.${field}.${id}`)).not.toBe(`vibe.${field}.${id}`);
        if (['look', 'pace', 'destination', 'audience'].includes(field)) expect(domains['vibe.{}.{}']).toContain(`${field}|${id}`);
    }
    for (const pace of [...CREATOR_ANSWERS.pace, 'unknown']) for (const chaos of [0, 1, 2, 3, 4]) {
        setLocaleFromDevice(['en']);
        expect(creatorCardName({ pace, chaos })).toBe(archetypeName({ pace, chaos }));
        setLocaleFromDevice(['es']);
        expect(creatorCardName({ pace, chaos })).not.toMatch(/language\./);
    }
    setLocaleFromDevice(['en']);
});
test('creator name uses translated id lookups even when the rendered words contain spaces', () => {
    const spanish = CATALOGS.es as Record<string, string>;
    const fixture = { 'language.creatorAdjective.1': 'de medianoche', 'language.creatorNoun.fox': 'iniciador de fuego', 'language.creatorName': '{noun}, {adjective}' };
    const previous = Object.fromEntries(Object.keys(fixture).map(key => [key, spanish[key]]));
    try {
        Object.assign(spanish, fixture); setLocaleFromDevice(['es']);
        expect(creatorCardName({ pace: 'fox', chaos: 2 })).toBe('iniciador de fuego, de medianoche');
    } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete spanish[key]; else spanish[key] = value; }
        setLocaleFromDevice(['en']);
    }
});
