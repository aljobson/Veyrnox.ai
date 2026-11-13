-- 0491: leading indexes for every single-column Music foreign key.
-- PostgreSQL does not create indexes on referencing columns automatically;
-- without these, parent updates/deletes and integrity checks scan whole tables.

CREATE INDEX IF NOT EXISTS music_export_attempts_job_idx ON public.music_export_attempts(job_id);
CREATE INDEX IF NOT EXISTS music_export_attempts_quote_idx ON public.music_export_attempts(quote_id);
CREATE INDEX IF NOT EXISTS music_export_quotes_period_idx ON public.music_export_quotes(period_id);
CREATE INDEX IF NOT EXISTS music_generation_candidates_song_idx ON public.music_generation_candidates(song_id);
CREATE INDEX IF NOT EXISTS music_generation_quotes_model_idx ON public.music_generation_quotes(model_id);
CREATE INDEX IF NOT EXISTS music_generation_quotes_prompt_spec_idx ON public.music_generation_quotes(prompt_spec_id);
CREATE INDEX IF NOT EXISTS music_generation_requests_model_idx ON public.music_generation_requests(model_id);
CREATE INDEX IF NOT EXISTS music_generation_requests_prompt_spec_idx ON public.music_generation_requests(prompt_spec_id);
CREATE INDEX IF NOT EXISTS music_lyric_drafts_model_idx ON public.music_lyric_drafts(model_id);
CREATE INDEX IF NOT EXISTS music_prompt_specs_model_idx ON public.music_prompt_specs(model_id);
CREATE INDEX IF NOT EXISTS music_publication_attestations_user_idx ON public.music_publication_attestations(user_id);
CREATE INDEX IF NOT EXISTS music_replace_take_commits_version_idx ON public.music_replace_take_commits(chosen_version_id);
CREATE INDEX IF NOT EXISTS music_replace_take_commits_request_idx ON public.music_replace_take_commits(generation_request_id);
CREATE INDEX IF NOT EXISTS music_replace_take_commits_song_idx ON public.music_replace_take_commits(song_id);
CREATE INDEX IF NOT EXISTS music_reuse_draft_receipts_song_idx ON public.music_reuse_draft_receipts(source_song_id);
CREATE INDEX IF NOT EXISTS music_reuse_draft_receipts_version_idx ON public.music_reuse_draft_receipts(source_version_id);
CREATE INDEX IF NOT EXISTS music_songs_current_version_idx ON public.music_songs(current_version_id);
CREATE INDEX IF NOT EXISTS music_songs_workspace_idx ON public.music_songs(workspace_id);
CREATE INDEX IF NOT EXISTS music_stem_quotes_model_idx ON public.music_stem_quotes(model_id);
CREATE INDEX IF NOT EXISTS music_stem_requests_model_idx ON public.music_stem_requests(model_id);
CREATE INDEX IF NOT EXISTS music_target_stem_assets_user_idx ON public.music_target_stem_assets(user_id);
CREATE INDEX IF NOT EXISTS music_target_stem_quotes_model_idx ON public.music_target_stem_quotes(model_id);
CREATE INDEX IF NOT EXISTS music_target_stem_requests_model_idx ON public.music_target_stem_requests(model_id);
CREATE INDEX IF NOT EXISTS music_track_add_quotes_track_model_idx ON public.music_track_add_quotes(track_model_id);
CREATE INDEX IF NOT EXISTS music_track_add_quotes_upload_model_idx ON public.music_track_add_quotes(upload_model_id);
CREATE INDEX IF NOT EXISTS music_track_add_requests_track_model_idx ON public.music_track_add_requests(track_model_id);
CREATE INDEX IF NOT EXISTS music_track_add_requests_upload_model_idx ON public.music_track_add_requests(upload_model_id);
CREATE INDEX IF NOT EXISTS music_workspace_members_invited_by_idx ON public.music_workspace_members(invited_by);
CREATE INDEX IF NOT EXISTS music_workspace_members_user_idx ON public.music_workspace_members(user_id);
CREATE INDEX IF NOT EXISTS music_workspace_moves_destination_idx ON public.music_workspace_moves(destination_workspace_id);
