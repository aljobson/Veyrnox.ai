import { VIDEO_EFFECTS, TRANSITIONS, EFFECT_CATEGORIES, TRANSITION_CATEGORIES } from '../../../app/veyrnox/_lib/editorEffects.mjs';
import { HSL_CHANNELS, CURVE_CHANNELS } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { BLENDS } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { CATALOGS, createTranslator, startupLocale, setLocaleFromDevice } from '../src/lib/i18n';
import { SKILL_GROUPS } from '../src/lib/studioSkills';
import { CREATOR_ANSWERS } from '../src/lib/creatorAnswers';
import { creatorCardName } from '../src/lib/creatorCardLabels';
import { archetypeName } from '../src/lib/creatorArchetype';
import en from '../src/lib/i18n/messages/en';
import { TTS_VOICES, TTS_EMOTIONS, TTS_EXAMPLES, TTS_INTERJECTIONS, TTS_INPUT_RULES, voiceGenderOptions } from '../src/lib/speech/shared';
declare const require: (id: string) => any;
declare const __dirname: string;
const fs = require('fs'), path = require('path'), ts = require('typescript');
// Fixed id domains for the dynamic t() families in production source. New families require a fixture;
// these are input ids, deliberately independent of translated output and the current catalog contents.
const domains: Record<string, readonly string[]> = {
    'musicRender.{}': ['fadeIn', 'fadeOut', 'speed', 'split', 'fade', 'reorder', 'remaster', 'reverse',
        'auth', 'missing', 'editingOff', 'reverseOff', 'service', 'uncertain', 'request', 'fadeRange', 'speedRange', 'splitRange',
        'peakRange', 'conflict', 'changed', 'format', 'wav', 'size', 'duration', 'source', 'silence', 'storage', 'measure', 'offline', 'refreshFailed'],
    'editorLook.{}': ['locked', 'lockedAll', 'notAdjacent'],
    'editor.{}': ['filters', 'effects', 'transitions'],
    'editorLook.parameter.{}': ['brightness', 'contrast', 'saturate', 'hue', 'blur', 'exposure',
        'temperature', 'tint', 'shadows', 'highlights', 'gamma', 'saturation', 'luminance'],
    'editorLook.channel.{}': [...new Set([...HSL_CHANNELS, ...CURVE_CHANNELS])],
    'editorLook.hsl.{}': ['hue', 'saturation', 'luminance'],
    'editorLook.category.{}': [...new Set([...EFFECT_CATEGORIES, ...TRANSITION_CATEGORIES])].filter(c => c !== 'All'),
    'editorLook.effect.{}': VIDEO_EFFECTS.map(e => e.id),
    'editorLook.transition.{}': [...TRANSITIONS.map(e => e.id), 'slide'],
    'editorLook.blend.{}': BLENDS,
    'editorLook.crop.{}': ['x', 'y', 'width', 'height'],
    'editorLook.background.{}': ['none', 'solid', 'blur', 'image'],
    'speech.audition.{}': ['add', 'remove', 'addOne', 'invalidVoices'],
    'beatLabs.seed.error.{}': ['r34', 'r35', 'r36', 'r37', 'unsupported'],
    'beatLabs.touch.{}': ['help', 'play', 'undo', 'redo', 'gridMove', 'gridToggle', 'pads', 'regionMove', 'regionResize', 'regionTrim', 'regionDuplicate', 'regionSplit', 'regionDelete', 'regionEdit', 'rulerMove', 'pianoSelectAll', 'pianoMove', 'pianoResize', 'pianoToggle', 'pianoDelete', 'pianoVelocity', 'automationMove', 'automationDelete', 'notes', 'octave', 'velocity'],
    'beatLabs.template.{}': ['hiphop', 'lofi', 'house', 'blank'],
    'beatLabs.template.{}.description': ['hiphop', 'lofi', 'house', 'blank'],
    'beatLabs.sound.{}': ['sub-one', 'pluck-two', 'acid', 'deep', 'stabs', 'electric', 'bells', 'organ', 'arp', 'pad', 'lead', 'sweep'],
    'beatLabs.category.{}': ['All', 'Bass', 'Keys', 'Synth', 'FX'],
    'beatLabs.tip.{}': ['grid', 'library', 'play', 'arrangement', 'export', 'shortcuts'],
    'beatLabs.context.{}': ['global', 'grid', 'regions', 'ruler', 'piano', 'automation', 'takes', 'typing'],
    'beatLabs.control.{}': ['help', 'play', 'ripple', 'undo', 'redo', 'gridMove', 'gridToggle', 'gridVelocity', 'regionMove', 'regionResize', 'regionTrim', 'regionDuplicate', 'regionSplit', 'regionDelete', 'regionEdit', 'rulerMove', 'rulerCancel', 'pianoSelectAll', 'pianoMove', 'pianoResize', 'pianoToggle', 'pianoDelete', 'pianoVelocity', 'automationMove', 'automationDelete', 'takeMove', 'takeAssign', 'takeClear', 'pads', 'notes', 'octave', 'velocity'],
    'editorCaptionTools.added.{}': ['one', 'other'],
    'editorCaptionTools.range.{}': ['one', 'other'],
    'editorCaptionTools.sources.{}': ['one', 'other'],
    'speech.tone.{}': [...new Set(TTS_VOICES.map(voice => voice.tone))],
    'speech.cue.{}': TTS_INTERJECTIONS.map(([, cue]) => cue.slice(1, -1)),
    'speech.emotion.{}': TTS_EMOTIONS,
    'speech.{}': Object.entries(TTS_INPUT_RULES).filter(([, rule]) => rule.type !== 'enum').map(([key]) => key.slice('tts_'.length)),
    'speech.example.{}': TTS_EXAMPLES.map((_, index) => String(index)),
    'speech.gender.{}': ['all', ...voiceGenderOptions()],
    'editorEditGate.{}': ['invalid', 'tooLarge'],
    'editorExportRefusal.{}': ['speed', 'audio', 'motion', 'animation', 'colour', 'crop', 'effects', 'blend', 'background', 'masks', 'smart', 'transitions', 'text', 'captions', 'position', 'fonts', 'images', 'originalAudio', 'assets', 'groups', 'unknown'],
    'musicDiscover.mood.{}': ['all', 'Hip-hop', 'Rock', 'Jazz'],
    'musicPlaylists.{}': ['titleInvalid', 'conflict', 'invalidSongs', 'offline', 'scanStale', 'saved', 'noneUnavailable', 'pending', 'signIn', 'denied', 'error'],
    'musicSectionActions.{}.title': ['add_section', 'replace_section'],
    'musicSectionActions.position.{}': ['beginning', 'end'],
    'musicSectionActions.duration.{}': ['10', '20', '30'],
    'musicSectionActions.{}': ['start', 'end'],
    'musicSectionActions.{}Less': ['start', 'end'],
    'musicSectionActions.{}More': ['start', 'end'],
    "musicGenerationActions.{}.title": ["extend", "cover"],
    "musicGenerationActions.{}.limit": ["extend", "cover"],
    "musicGenerationActions.state.{}": ["queued", "running", "succeeded", "partial", "failed", "refunded"],
    'musicTargetStems.state.{}': ['queued', 'running', 'ready', 'failed', 'refunded'],
    'musicTargetStems.instrument.{}': ['vocals', 'drums', 'bass', 'guitar', 'piano', 'strings', 'synthesizer', 'brass', 'woodwinds'],
    'musicActions.stems.{}': ['queued', 'running', 'ready', 'failed', 'refunded'],
    'musicActions.{}.title': ['stems', 'crop'],
    'musicActions.action.{}': ['rights', 'format', 'plan', 'model', 'notAffordable', 'expired', 'changed', 'consent', 'range', 'short', 'busy', 'source', 'recovery', 'network', 'error'],
    'music.create.{}': ['simple', 'custom', 'empty_prompt', 'over_length', 'locked_plan', 'unavailable', 'rights', 'no_slot', 'not_affordable', 'quote_expired', 'quote_stale', 'quote_already_used', 'conflict', 'prompt_not_allowed', 'model_unavailable', 'plan_unavailable', 'rights_required', 'error', 'queued', 'running', 'ready', 'failed', 'refunded', 'cancelled'],
    'beatAi.{}': ['generate', 'stems', 'targetStems', 'extend', 'replace', ...Array.from({ length: 45 }, (_, n) => `a${n}`)],
    'beat.{}': ['gain', 'pan'],
    'beatMix.fx.{}': ['eq', 'compressor', 'distortion', 'delay', 'reverb'],
    'beatMix.param.{}': ['low', 'mid', 'high', 'threshold', 'ratio', 'time', 'feedback', 'mix', 'size'],
    'beatMix.unit.{}': ['percent', 'db', 'seconds', 'ratio'],
    'beatMix.locked.{}': ['gain', 'pan'],
    'beatMix.lane.{}': ['gain', 'pan'],
    'beatMix.lane.show.{}': ['gain', 'pan'],
    'beatMix.send.{}': ['reverb', 'delay'],
    'beatPiano.library.group.{}': ['piano', 'guitar', 'drums', 'bass', 'synth', 'wavetable'],
    'beat.local.{}': ['saved', 'saving', 'error', 'busy'],
    'beat.cloud.{}': ['checking', 'off', 'unlinked', 'other', 'signed_out', 'syncing', 'synced', 'conflict', 'paused_conflict', 'removed', 'limit', 'rate_limited', 'offline', 'error', 'takes'],
    'beat.pad.{}': ['kick', 'snare', 'hat', 'openhat', 'clap', 'tom', 'rim', 'crash'],
    'beat.kit.{}': ['acoustic', '808', 'lofi'],
    'music.tab.{}': ['songs', 'history', 'hooks'],
    'music.empty.{}': ['songs', 'history', 'hooks'],
    'musicPublic.reaction.{}': ['fire', 'love', 'wow', 'praise', 'like', 'cool', 'hot'],
    'musicPublic.genre.{}': ['pop', 'hip-hop', 'rock', 'electronic', 'house', 'lo-fi', 'jazz', 'rnb-soul', 'ambient', 'cinematic', 'country-folk', 'latin'],
    'music.player.{}': ['idle', 'loading', 'playing', 'paused', 'error', 'held', 'ended', 'background'],
    'templates.kind.{}': ['video', 'audio'],
    'audioTemplates.cat.{}': ['MUSIC', 'VOICE-OVER', 'SOUND FX'],
    'app.create.error.{}': ['price_changed', 'admission_unknown', 'admission_unavailable'],
    'wins.{}': ['week', 'all', 'creations', 'posts', 'streak', 'image', 'videoType', 'audio', 'other', 'first_image', 'first_video', 'creations_10', 'creations_50', 'first_post', 'first_cinema_upload', 'streak_7'],
    'mediaKind.{}': ['image', 'video', 'audio', 'text'],
    'editorSpeech.{}': ['silences', 'retakes', 'fillers', 'quoting', 'queued', 'transcribing', 'planning'],
    'editor.track.{}': ['video', 'audio', 'text'],
    'start.continue.{}': ['photo', 'video', 'reference', 'prompt'],
    'credits.plan.{}': ['lite', 'starter', 'plus', 'ultra'],
    'presets.cat.{}': ['ALL', 'NEW', 'POPULAR', 'YOUR PHOTO', 'KIDS BIRTHDAY', 'CINEMATIC', 'ANIME', 'CARTOONS', 'MOVIES', 'FANTASY', 'REALISTIC', 'FASHION', 'PRODUCTS', 'VFX', 'UGC', 'ADS'],
    'presets.swap.{}': ['submitting', 'unknown', 'unresolved', 'not_charged', 'refund_pending', 'refunded', 'queued', 'running', 'succeeded'],
    "publishTiming.move.{}": ["done", "serverHas", "started", "canceled", "unscheduled", "sending", "stillPending", "pending"],
    "publishOps.priority.{}": ["normal", "high", "urgent"],
    "publishOps.queue.reason.{}": ["publishingOff", "disconnected"],
    "publishOps.csv.{}": ["empty", "headers", "columns", "row", "quote", "tooMany", "duplicate", "type", "size"],
    "skillsUi.bestFor.{}": ["Make", "Edit", "Plan", "Film"],
    "skillsUi.output.{}": ["Make", "Edit", "Plan", "Film"],
    "publishParity.youtube.{}": ["private", "unlisted", "public"],
    "ads.mode.{}": ["standalone", "boost"],
    "ads.objective.{}": ["awareness", "traffic", "engagement", "leads", "sales"],
    "ads.status.{}": ["draft", "paused", "active", "completed"],
    "appearance.{}": ["mint", "iris", "sky", "rose", "mono", "studio", "editorial", "technical", "s", "m", "l", "xl", "firstCreation", "firstVideo", "afterOnboarding"],
    "approvals.policy.{}": ["any", "all"],
    "facelessReel.error.{}": ["topicShort", "topicLong", "hookLong", "duration", "soundDuration", "review", "promptLong"],
    "facelessReel.format.{}.description": ["explainer", "list", "microStory", "mood"],
    "facelessReel.format.{}.label": ["explainer", "list", "microStory", "mood"],
    "facelessReel.pacing.{}.label": ["measured", "balanced", "fast"],
    "facelessReel.platform.{}": ["reels", "shorts", "web"],
    "facelessReel.transfer.{}": ["brief", "duration", "frame", "direction", "sound", "soundOptional", "separate"],
    "facelessReel.workflow.{}": ["idea", "rhythm", "review"],
    "publishDepth.analytics.{}": ["conversations", "received", "sent", "failed", "read_actions", "median"],
    "publishDepth.reply.{}": ["anyway", "discard"],
    "publishDepth.reply.{}Body": ["anyway", "discard"],
    "publishDepth.reply.{}Title": ["anyway", "discard"],
    "bestCut.language.{}": ["en", "es", "zh", "hi", "ar", "fr", "pt", "ru", "ja", "de", "ko"],
    "bestCut.warning.{}": ["tail", "sections", "language"],
    "bestCut.{}": ["balanced", "vlog", "educational", "punchy", "steps", "ready", "uploading", "preflight", "transcribing", "no-speech", "complete"],
    "brand.problem.{}": ["name", "palette", "fonts", "size", "styles", "assets"],
    "brand.asset.field.{}": ["name", "credit", "usage", "url"],
    "brand.style.{}": ["name", "size", "color", "background", "stroke", "strokeWidth", "font", "weight", "align", "normal", "bold", "left", "center", "right", "italic", "underline"],
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
    "faceFilters.look.{}": ["original", "clarity", "glow", "warm", "cool", "fade", "vivid", "soft", "mono"],
    "faceFilters.{}": ["face-retouch", "face-enhance", "face-relight", "face-makeup", "face-age", "face-costume", "costume_style", "clown", "creepy_clown", "ghost", "zombie", "skeleton", "vampire", "masquerade", "jester", "wig_blonde", "wig_pink", "wig_curly", "wig_powdered", "before", "after", "makeup_style", "intensity", "natural", "glamorous", "smoky_eyes", "bold_lips", "no_makeup", "remove_makeup", "dramatic", "bridal", "professional", "korean_style", "artistic", "light", "medium", "heavy"],
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
    "app.smartCut.pacing.{}": ["snappy", "balanced", "relaxed"],
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

test.each([
    ['en', 1, 'Added 1 caption.', '1 word selected, 0 to 2', '1 caption has word timing'],
    ['en', 2, 'Added 2 captions.', '2 words selected, 0 to 2', '2 captions have word timing'],
    ['ru', 1, 'Добавлен 1 субтитр.', 'Выбрано 1 слово, от 0 до 2', '1 субтитр со временем слов'],
    ['ru', 2, 'Добавлено 2 субтитра.', 'Выбрано 2 слова, от 0 до 2', '2 субтитра со временем слов'],
] as const)('%s caption plurals for count %s', (locale, count, added, range, sources) => {
    const tr = createTranslator(locale, CATALOGS);
    expect(tr.plural('editorCaptionTools.added', count)).toBe(added);
    expect(tr.plural('editorCaptionTools.range', count, { start: 0, end: 2 })).toBe(range);
    expect(tr.plural('editorCaptionTools.sources', count)).toBe(sources);
});
