'use client';
import { useState } from 'react';
import { Button } from '../Button';
import { useEditorResource } from './useEditorResource';
import { formatTime } from '../../_lib/editorTimeline.mjs';
export function ReviewPanel({project,frame,disabled,onSeek}) {
    const resource=useEditorResource(project?.id && project.revision>0?`/projects/${project.id}/review?revision=${project.revision}`:null),[draft,setDraft]=useState(null);
    const draftScope=[resource.accountId,project?.id,project?.revision].join(':');
    const body=draft?.scope===draftScope?draft.text:'',setBody=text=>setDraft({scope:draftScope,text});
    if(!project?.id || !project.revision)return <p className="text-xs">Save a project version to review it.</p>;
    async function add(){const result=await resource.mutate({revision:project.revision,frame,body},'POST');if(result){setBody('');resource.reload();}}
    async function resolve(comment){const result=await resource.mutate({comment_id:comment.id,expected_version:comment.version,resolved:!comment.resolved},'PATCH');if(result)resource.reload();}
    return <section aria-label="Project review" className="space-y-3"><h2 className="text-sm font-bold">Review saved version {project.revision}</h2>
        <p className="text-xs">Comments belong to this saved version. The project link requires workspace access.</p>
        {project.dirty && <p role="status" className="text-xs">Save the current edit before posting or jumping to a comment.</p>}{resource.error && <p role="alert" className="text-xs">{resource.error}</p>}
        <a className="block text-xs text-vx-accent underline" href={`/app/editor/review?project=${project.id}&revision=${project.revision}`}>Open review of this saved version</a>
        <textarea aria-label="Review comment" className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" rows={3} maxLength={2000} value={body} disabled={disabled || resource.busy || !resource.data?.canComment || project.dirty} onChange={e=>setBody(e.target.value)} />
        <Button size="sm" disabled={disabled || resource.busy || !body.trim() || !resource.data?.canComment || project.dirty} onClick={add}>Comment at {formatTime(frame)}</Button><Button size="sm" variant="ghost" disabled={resource.busy} onClick={resource.reload}>Refresh comments</Button>
        {resource.data?.truncated && <p role="status" className="text-xs">Showing {resource.data.comments.length} of {resource.data.total} comments on this version.</p>}
        {resource.data?.nextCursor && <Button size="sm" variant="ghost" disabled={resource.busy} onClick={()=>resource.loadMore(resource.data.nextCursor)}>Load earlier comments</Button>}
        <ol className="space-y-2">{resource.data?.comments?.map(comment=><li key={comment.id} className="rounded border border-vx-border p-2 text-xs"><button type="button" className="text-vx-accent underline" disabled={project.dirty} onClick={()=>onSeek(comment.frame)}>{formatTime(comment.frame)}</button> · {comment.resolved?'Resolved':'Open'}<p className="whitespace-pre-wrap break-words">{comment.body}</p><p className="text-vx-fg-muted">{new Date(comment.created_at).toLocaleString()}</p>{resource.data.canResolve && <Button size="sm" variant="ghost" disabled={disabled || resource.busy} onClick={()=>resolve(comment)}>{comment.resolved?'Reopen comment':'Resolve comment'}</Button>}</li>)}</ol>
    </section>;
}
