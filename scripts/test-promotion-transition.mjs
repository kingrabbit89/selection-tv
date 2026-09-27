import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTransition} from './validate-promotion-transition.mjs';
const fixture=()=>{
 const before={latest:'2026-S41',weeks:[{week:'2026-S41',from:'2026-10-03',status:'published'},{week:'2026-S42',from:'2026-10-10',status:'draft'}]};
 const after=structuredClone(before);after.latest='2026-S42';after.weeks[1].status='published';
 const oldWeek={week:'2026-S42',publication_status:'draft',pages:[{id:'couverture',html:'Editorial verified'}]};
 return [before,after,oldWeek,{...oldWeek,publication_status:'published'},['data/manifest.json','data/weeks/2026-S42.json'],'promote/2026-S42'];
};
test('accept only status promotion of an existing draft',()=>assert.equal(validateTransition(...fixture()),'2026-S42'));
for(const [name,mutate] of [
 ['editorial edit',a=>a[3]={...a[3],pages:[]}],
 ['unrelated file',a=>a[4].push('assets/js/seen-filter.js')],
 ['wrong branch',a=>a[5]='auto/2026-S42'],
 ['wrong week branch',a=>a[5]='promote/2026-S43'],
 ['missing draft',a=>a[0].weeks.pop()],
 ['already published draft',a=>a[2].publication_status='published'],
 ['manifest editorial edit',a=>a[1].weeks[1].title='Changed'],
 ['backwards date',a=>{a[0].weeks[1].from='2026-09-01';a[1].weeks[1].from='2026-09-01'}],
 ['missing week change',a=>a[4].pop()]
])test('reject '+name,()=>{const a=fixture();mutate(a);assert.throws(()=>validateTransition(...a))});
