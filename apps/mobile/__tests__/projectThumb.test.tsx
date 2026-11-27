import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { ProjectThumb } from '../src/components/CreationThumbs';
import { projectCoverFor } from '../src/lib/projectCoverCache';

jest.mock('../src/components/JobThumb', () => ({ JobThumb: 'JobThumb' }));
jest.mock('../src/lib/projectCoverCache', () => ({ projectCoverFor: jest.fn() }));

const mockedCover = projectCoverFor as jest.MockedFunction<typeof projectCoverFor>;
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockedCover.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('renders the saved frame, title and arbitrary title colour in project lists', async () => {
    mockedCover.mockResolvedValue({ jobId: '11111111-1111-4111-8111-111111111111', posterTimeSeconds: 2.75,
        text: 'Morning routine', textColor: '#12AB34', background: '#000000' });
    await act(async () => root.render(<ProjectThumb api={{} as never} links={{} as never} projectId="project-1" size={48} />));
    const thumb = root.container.queryAll(node => node.type === 'JobThumb')[0];
    expect(thumb.props).toMatchObject({ jobId: '11111111-1111-4111-8111-111111111111', posterTimeSeconds: 2.75, size: 48 });
    const title = root.container.queryAll(node => node.props.children === 'Morning routine')[0];
    expect(title.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ color: '#12AB34' })]));
});
