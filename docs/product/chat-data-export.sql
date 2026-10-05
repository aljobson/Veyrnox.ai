-- Export one person's chat conversations (GDPR portability and access), as one JSON document.
--
-- How to use it: in the Supabase SQL editor of the production project (veyrnox-ai-production-eu), replace the e-mail
-- address below with the address on the account, run it, and save the single result cell as a .json file. Do this
-- only after checking the request really comes from the account holder, as the GDPR page describes (email from the
-- address on the account). The chat tables are closed to the API and to the browser roles on purpose, so this runs as
-- the project owner in the editor, not through the app.
--
-- What it holds: each chat's title, model, instructions and messages in order, with each message's role, text, status,
-- Credits charged and time. Attached images are not included: they are deleted from storage within 24 hours of the
-- reply, and the thread only ever kept their type and size. The credit history is part of the account export.
-- Returns no row if the e-mail has no account.
SELECT jsonb_pretty(jsonb_build_object(
    'exported_at', now(),
    'account_email', u.email,
    'chats', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'title', t.title,
            'model', t.model_id,
            'instructions', t.system_prompt,
            'pinned', t.pinned,
            'created_at', t.created_at,
            'messages', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'role', m.role, 'text', m.content, 'status', m.status, 'credits', m.credits, 'sent_at', m.created_at
                ) ORDER BY m.seq), '[]'::jsonb)
                FROM public.chat_messages m WHERE m.thread_id = t.id
            )
        ) ORDER BY t.created_at)
        FROM public.chat_threads t WHERE t.user_id = u.id
    ), '[]'::jsonb)
)) AS chat_export
FROM public.users u
WHERE lower(u.email) = lower('user@example.com');
