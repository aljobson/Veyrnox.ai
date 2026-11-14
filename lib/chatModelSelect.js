/** Catalog reads for Chat that survive a database a little behind the Worker (ADR-0067). */
// Columns a Worker may ask for before the migration that adds them is applied: chat_web_engine (0213) and
// chat_long_text_extra_credits (0517). Without the first every row is a plugin row; without the second no row offers a long message.
const LATE_COLUMNS = Object.freeze(['chat_web_engine', 'chat_long_text_extra_credits']);

/**
 * Read catalog rows for chat, tolerating a database that has not had a late column's migration yet. Merges deploy before the owner
 * approves a migration, so the code that reads those columns must not take chat down in that gap: if (and only if) the database says
 * one of them does not exist, read again without it. Any other failure is a real one and is rethrown. Not a retry loop: at most one
 * more call per late column.
 * @param {Function} select the injected select(table, {columns, filter}, cfg)
 */
export async function selectChatModels(select, query, cfg) {
    let columns = String(query.columns);
    for (let tries = 0; ; tries += 1) {
        try {
            return await select('model_catalog', tries ? { ...query, columns } : query, cfg);
        } catch (err) {
            const body = String((err && err.body) || '');
            const late = err && err.status === 400 && body.includes('does not exist')
                ? LATE_COLUMNS.find((c) => body.includes(c) && columns.split(',').includes(c)) : undefined;
            if (!late || tries >= LATE_COLUMNS.length) throw err;
            columns = columns.split(',').filter((c) => c !== late).join(',');
        }
    }
}
