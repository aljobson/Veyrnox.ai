declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync: (p: string, e: 'utf8') => string };
const { join } = require('path') as { join: (...p: string[]) => string };

const source = readFileSync(join(__dirname, '..', 'src', 'app', '(app)', 'create', '[modelId].tsx'), 'utf8');

// Source pins for the Create form (it needs the whole app to render): the primary button keeps its in-progress
// state until every result has settled, names what is missing, and promises a rough time for video.
describe('Create primary button states', () => {
    it('stays "Creating…" and disabled until every result of the batch has settled', () => {
        expect(source).toContain('const inProgress = complete && settled < (results?.ids.length ?? 0);');
        expect(source).toContain("label={inProgress ? t('job.running') : complete ?");
        expect(source).toMatch(/const disabled = busy \|\| waiting \|\| inProgress \|\|/);
        expect(source).toContain('setSettled(count => count + 1)');
    });
    it('says under the button what is missing, and gives video a rough time', () => {
        expect(source).toContain('missingNeedKey(model, references, !!startFile');
        expect(source).toContain('<CreateStatusNotes need={needText} expectedMinutes={expectedMinutes} />');
        expect(source).toContain("accessibilityHint={needText ? rawText(needText) : undefined}");
        expect(readFileSync(join(__dirname, '..', 'src', 'components', 'create', 'CreateStatusNotes.tsx'), 'utf8')).toContain("t('create.expectedVideo'");
    });
    it('words the optional prompt for the kind of tool', () => {
        expect(source).toContain("isVideo ? 'form.describeMotion' : kindOf(model.modality) === 'audio' ? 'form.describeSound' : 'form.describeChange'");
    });
});
