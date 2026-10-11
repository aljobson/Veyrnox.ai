import { notFound } from 'next/navigation';
import { ReviewWorkspace } from '../../../_components/editor/ReviewWorkspace';
export const metadata={title:'Review saved edit',robots:{index:false,follow:false}};
export default async function Page({searchParams}) {
    if(process.env.EDITOR_SHARED_TOOLS_ENABLED!=='true' || process.env.TENANT_PROJECTS_ENABLED!=='true')notFound();
    const {project,revision}=await searchParams;
    if(typeof project!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project) || typeof revision!=='string' || !/^[1-9][0-9]{0,8}$/.test(revision))notFound();
    return <ReviewWorkspace key={`${project}:${revision}`} projectId={project.toLowerCase()} revision={Number(revision)} />;
}
