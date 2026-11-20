import { createBeat } from '../../app/veyrnox/_lib/music/beat/beatDocument.mjs';
// Stored v5 data supplied by another capable client; product code never upgrades here.
export const v5BeatFixture = () => ({ ...createBeat({ id: 'a77dcbd3-d1c6-4a86-b93b-58025d882a95', now: 1 }), version: 5 });
