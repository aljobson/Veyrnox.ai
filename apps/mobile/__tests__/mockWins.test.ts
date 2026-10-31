declare const __dirname: string;
const { execFileSync } = require('child_process'), { resolve } = require('path');
test('dev wins mock has both ranges, views, streak and a locked milestone; disabled returns 404', () => {
    execFileSync('node', ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { mockWins } from ${JSON.stringify(resolve(__dirname, '../dev/mockWins.mjs'))};
        assert.deepEqual(mockWins('GET',false),{status:404,body:{error:'not_found'}});
        assert.equal(mockWins('POST',true).status,405);
        const result=mockWins('GET',true,Date.parse('2026-11-01T12:00:00Z'));
        assert.equal(result.status,200);assert.equal(result.body.week_start,'2026-10-26T00:00:00.000Z');
        const {week,all,streak,milestones}=result.body;
        for(const period of [week,all]) {
            assert.equal(Object.values(period.creations.by_type).reduce((a,b)=>a+b,0),period.creations.total);
            assert.ok(period.views.total>0);assert.ok(period.views.networks.length>0);
        }
        assert.ok(all.creations.total>week.creations.total);assert.equal(streak.last7.length,7);
        assert.ok(milestones.some(m=>m.reached_at));assert.equal(milestones.filter(m=>!m.reached_at).length,1);
    `]);
});
export {};
