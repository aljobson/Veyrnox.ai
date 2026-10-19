'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { useState } from 'react';
import { Button } from '../Button';
import { useEditorResource } from './useEditorResource';
import { formatTime } from '../../_lib/editorTimeline.mjs';
export function ReviewPanel({project,frame,disabled,onSeek}) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const time = value => locale === 'en' ? formatTime(value) : formatTime(value).replace(/\d+/g, part => new Intl.NumberFormat(localeTag(locale), {useGrouping:false,minimumIntegerDigits:part.length}).format(Number(part)));
    const resource=useEditorResource(project?.id && project.revision>0?`/projects/${project.id}/review?revision=${project.revision}`:null),[draft,setDraft]=useState(null);
    const draftScope=[resource.accountId,project?.id,project?.revision].join(':');
    const body=draft?.scope===draftScope?draft.text:'',setBody=text=>setDraft({scope:draftScope,text});
    if(!project?.id || !project.revision)return <p className="text-xs">{t("app.editor.review.save")}</p>;
    async function add(){const result=await resource.mutate({revision:project.revision,frame,body},'POST');if(result){setBody('');resource.reload();}}
    async function resolve(comment){const result=await resource.mutate({comment_id:comment.id,expected_version:comment.version,resolved:!comment.resolved},'PATCH');if(result)resource.reload();}
    return <section aria-label={t("app.editor.review.title")} className="space-y-3"><h2 className="text-sm font-bold">{t("app.editor.review.version", {number:number(project.revision)})}</h2>
        <p className="text-xs">{t("app.editor.review.help")}</p>
        {project.dirty && <p role="status" className="text-xs">{t("app.editor.review.dirty")}</p>}{resource.error && <p role="alert" className="text-xs">{resource.error}</p>}
        <a className="block text-xs text-vx-accent underline" href={`/app/editor/review?project=${project.id}&revision=${project.revision}`}>{t("app.editor.review.open")}</a>
        <textarea data-testid="review-comment" aria-label={t("app.editor.review.comment")} className="w-full rounded border border-vx-border bg-vx-base p-2 text-xs" rows={3} maxLength={2000} value={body} disabled={disabled || resource.busy || !resource.data?.canComment || project.dirty} onChange={e=>setBody(e.target.value)} />
        <Button size="sm" disabled={disabled || resource.busy || !body.trim() || !resource.data?.canComment || project.dirty} onClick={add}>{t("app.editor.review.at", {time:time(frame)})}</Button><Button size="sm" variant="ghost" disabled={resource.busy} onClick={resource.reload}>{t("app.editor.review.refresh")}</Button>
        {resource.data?.truncated && <p role="status" className="text-xs">{t(pluralKey(t, locale, "app.editor.review.showing", resource.data.total), {count:number(resource.data.comments.length),total:number(resource.data.total)})}</p>}
        {resource.data?.nextCursor && <Button size="sm" variant="ghost" disabled={resource.busy} onClick={()=>resource.loadMore(resource.data.nextCursor)}>{t("app.editor.review.earlier")}</Button>}
        <ol className="space-y-2">{resource.data?.comments?.map(comment=><li key={comment.id} className="rounded border border-vx-border p-2 text-xs"><button type="button" className="text-vx-accent underline" disabled={project.dirty} onClick={()=>onSeek(comment.frame)}>{time(comment.frame)}</button> · {comment.resolved?t("app.publish.inbox.state.resolved"):t("app.editor.review.openStatus")}<p className="whitespace-pre-wrap break-words">{comment.body}</p><p className="text-vx-fg-muted">{new Date(comment.created_at).toLocaleString(localeTag(locale))}</p>{resource.data.canResolve && <Button size="sm" variant="ghost" disabled={disabled || resource.busy} onClick={()=>resolve(comment)}>{comment.resolved?t("app.editor.review.reopen"):t("app.editor.review.resolve")}</Button>}</li>)}</ol>
    </section>;
}
