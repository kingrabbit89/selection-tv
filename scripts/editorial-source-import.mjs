// Normalize acquired guide observations into a reviewable inventory handoff.
// Collection does not certify work identity, independent recall or coverage.
import assert from 'node:assert/strict';
import {digest} from './editorial-handoff.mjs';
import {addDays,weekForSaturday} from './week-calendar.mjs';
import {normalizedTitle} from './editorial-work-packet.mjs';

const array=value=>Array.isArray(value)?value:[];
const unique=values=>[...new Set(values)];
const slot=item=>JSON.stringify([item.date,normalizedTitle(item.channel),item.start]);
const key=item=>slot(item)+'|'+normalizedTitle(item.title);

export function buildSourceInventoryHandoff(context,sourceReport,{from,base_inventory_content,generated_at}={}) {
  assert.match(context.sha || '',/^[a-f0-9]{40}$/,'immutable source SHA required');
  assert.equal(weekForSaturday(from),context.week,'inventory week/date mismatch');
  assert(Number.isFinite(Date.parse(generated_at)),'observed generation time required');
  const to=addDays(from,6), original=context.inventory;
  if (original) {
    assert.equal(original.week,context.week,'inventory belongs to another week');
    assert(typeof base_inventory_content==='string','exact original inventory content required');
    assert.deepEqual(JSON.parse(base_inventory_content),original,'inventory does not match exact base content');
  } else assert(base_inventory_content===null,'new inventory requires absent base');
  const remaining=array(context.research?.remaining);
  assert(remaining.length && remaining.every(text=>typeof text==='string' && text.trim()),'unfinished requirements required');
  assert(Array.isArray(sourceReport?.observations) && Array.isArray(sourceReport.source_results),'source observations/results required');
  const sources=sourceReport.source_results;
  const inventory=original?structuredClone(original):{schema_version:1,week:context.week,range:`${from} — ${to}`,
    mode:'inventory-first — checkpoint partiel',note:'Raw source observations before editorial selection; no quality or coverage certification.',days:[]};
  const rows=new Map(array(inventory.days).map(day=>[day.date,day]));
  const seen=new Set(), slots=new Map(), added=[],duplicates=[],excluded=[],conflicts=[],touched=new Set();
  for (const day of rows.values()) for (const item of array(day.items)) {
    const scoped={...item,date:day.date};seen.add(key(scoped));
    const values=slots.get(slot(scoped)) || [];values.push(item.title);slots.set(slot(scoped),values);
  }
  for (const item of sourceReport.observations) {
    assert(item && typeof item==='object','invalid source observation');
    for (const field of ['title','channel','source','source_url']) assert(typeof item[field]==='string' && item[field].trim(),'source observation '+field+' required');
    assert.match(item.date || '',/^\d{4}-\d{2}-\d{2}$/,'source observation date required');
    assert.equal(addDays(item.date,0),item.date,'invalid observation date');
    assert.match(item.start || '',/^(?:[01]\d|2[0-3]):[0-5]\d$/,'source observation start required');
    const matching=sources.filter(result=>result.url===item.source_url && result.channel===item.channel &&
      array(result.observations).some(observation=>key(observation)===key(item)));
    if(matching.length && matching.every(result=>result.status==='stale')) {
      excluded.push({date:item.date,title:item.title,channel:item.channel,start:item.start,source_url:item.source_url,reason:'stale_source_after_failed_refresh'});
      continue;
    }
    assert(matching.some(result=>['parsed','partial'].includes(result.status)), 'observation lacks its parsed source result');
    if (item.date<from || item.date>to) {excluded.push({date:item.date,title:item.title,channel:item.channel,start:item.start,source_url:item.source_url});continue;}
    if (seen.has(key(item))) {duplicates.push({date:item.date,title:item.title,channel:item.channel,start:item.start,source_url:item.source_url});continue;}
    const names=slots.get(slot(item)) || [];
    if (names.some(title=>normalizedTitle(title)!==normalizedTitle(item.title))) {
      conflicts.push({date:item.date,start:item.start,channel:item.channel,
        saved_titles:[...names],observed_title:item.title,source_url:item.source_url,identity_resolved:false});
      continue;
    }
    let day=rows.get(item.date);
    if (!day) {day={date:item.date,status:'partial',scan_window:'00:00-23:59',channels_scanned:[],source_pages:[],channel_sources:{},channel_counts:{},items:[]};rows.set(item.date,day);}
    const saved=structuredClone(item);delete saved.date;
    day.items=array(day.items);day.items.push(saved);seen.add(key(item));
    names.push(item.title);slots.set(slot(item),names);touched.add(day.date);added.push({date:item.date,title:item.title,channel:item.channel,start:item.start,source_url:item.source_url});
  }
  for (const date of touched) {
    const day=rows.get(date);
    day.source_pages=unique([...array(day.source_pages),...day.items.map(item=>item.source_url).filter(Boolean)]);
    day.channels_scanned=unique([...array(day.channels_scanned),...day.items.map(item=>item.channel)]);
    const counts=Object.fromEntries(day.channels_scanned.map(channel=>[channel,0]));
    const channelSources=structuredClone(day.channel_sources || {});
    for (const item of day.items) {counts[item.channel]=(counts[item.channel] || 0)+1;
      channelSources[item.channel]=unique([...array(channelSources[item.channel]),item.source_url].filter(Boolean));}
    day.channel_counts=counts;day.channel_sources=channelSources;
  }
  inventory.days=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
  const changed=added.length>0;
  if (changed) inventory.updated_at=generated_at;
  const content=JSON.stringify(inventory,null,2)+'\n';
  const bundle={schema_version:1,week:context.week,base_sha:context.sha,stage:context.research?.stage || 'inventory',remaining:[...remaining],
    files:changed?[{path:`data/inventory/${context.week}.json`,base_sha256:digest(base_inventory_content),content}]:[]};
  return {bundle,inventory,report:{publication_ready:false,coverage_certified:false,added_observations:added.length,
    duplicate_observations:duplicates.length,excluded_observations:excluded.length,conflicting_events:conflicts,
    source_dates:sourceReport.source_results.map(result=>({id:result.id,url:result.url,status:result.status,fetched_at:result.evidence?.fetched_at || null})),
    added,duplicates,excluded,note:'Raw inventory additions only. Saved facts are never replaced. Title conflicts remain scoped to their events; coverage flags and editorial review are unchanged.'}};
}
