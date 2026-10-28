declare const __dirname: string;
const { execFileSync } = require('child_process'), { resolve } = require('path');
test('mock inbox read, priority, tags, filtering, resolve, assign and reply persist', () => {
    execFileSync('node', ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { mockInbox } from ${JSON.stringify(resolve(__dirname, '../dev/mockInbox.mjs'))};
        const id='33333333-3333-4333-8333-333333333333', base='/api/v1/social/inbox';
        let result, status;
        const call=(url=base,method='GET',body={}) => { assert.equal(mockInbox({url,method}, {}, url.split('?')[0], body, (res,s,b)=>{status=s;result=b}),true); return result; };
        assert.equal(call().counts.unread,1); assert.equal(call().threads[0].unread_count,1);
        call(base+'/'+id,'PATCH',{action:'read'}); assert.equal(call().counts.unread,0); assert.equal(call().threads[0].unread_count,0);
        call(base+'/'+id,'PATCH',{action:'priority',priority:'high'}); call(base+'/'+id,'PATCH',{action:'tags',tags:[' VIP ', 'vip','café']});
        assert.equal(call().threads[0].priority,'high'); assert.deepEqual(call().threads[0].tags,['vip','café']);
        assert.deepEqual(call(base+'?priority=urgent').threads,[]); assert.deepEqual(call(base+'?tag=other').threads,[]); assert.equal(call(base+'?tag=vip&priority=high').threads.length,1);
        call(base+'/'+id,'PATCH',{action:'resolve'}); assert.equal(call().counts.resolved,1); assert.equal(call().counts.unresolved,0);
        call(base+'/'+id,'PATCH',{action:'reopen'}); assert.equal(call().counts.resolved,0);
        call(base+'/'+id,'PATCH',{action:'assign',userId:'44444444-4444-4444-8444-444444444444'}); assert.equal(call().threads[0].assigned_email,'sam@veyrnox.ai');
        call(base+'/'+id,'PATCH',{action:'unassign'}); assert.equal(call().threads[0].assigned_email,null);
        call(base+'/'+id+'/reply','POST',{body:' reply '}); assert.equal(call(base+'/'+id).messages.at(-1).body,'reply');
        call(base+'/'+id+'/reply','POST',{body:''}); assert.equal(status,400);
        assert.equal(mockInbox({url:'/other',method:'GET'}, {}, '/other', {}, ()=>{}),false);
    `]);
});
export {};

test('mock inbox filters by assignee and search', () => {
    execFileSync('node', ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { mockInbox } from ${JSON.stringify(resolve(__dirname, '../dev/mockInbox.mjs'))};
        const base='/api/v1/social/inbox', id='33333333-3333-4333-8333-333333333333', member='44444444-4444-4444-8444-444444444444';
        const call=(url=base,method='GET',body={}) => { let result; mockInbox({url,method}, {}, url.split('?')[0], body, (res,s,b)=>{result=b}); return result; };
        assert.equal(call(base+'?assignee=unassigned').threads.length,1);
        assert.equal(call(base+'?assignee='+member).threads.length,0);
        for (const search of ['maya','GIFT CARD','poster set']) assert.equal(call(base+'?search='+encodeURIComponent(search)).threads.length,1);
        assert.equal(call(base+'?search=zzz').threads.length,0);
        call(base+'/'+id,'PATCH',{action:'assign',userId:member});
        assert.equal(call(base+'?assignee=unassigned').threads.length,0);
        assert.equal(call(base+'?assignee='+member+'&search=gift%20card').threads.length,1);
        assert.equal(call(base+'?assignee=55555555-5555-4555-8555-555555555555').threads.length,0);
        call(base+'/'+id,'PATCH',{action:'unassign'});
        assert.equal(call(base+'?assignee=unassigned').threads.length,1);
        call(base+'/'+id+'/reply','POST',{body:'Unique reply text'});
        assert.equal(call(base+'?search=UNIQUE').threads.length,1);
    `]);
});
