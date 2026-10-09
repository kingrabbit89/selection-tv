// Remove only provable duplicate reserve positions. No new selection, source,
// shortage explanation, certification, HTML or publication mutation is made.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {htmlText, decodeHtmlEntities} from './html-text.mjs';
import {sectionPageMatches} from './editorial-contracts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
// Exact spelling after Unicode/whitespace normalization: no prefix, fuzzy,
// accent-stripping or punctuation-stripping matches between different films.
const titleKey = value => String(value || '').normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase('fr');
const versionFields = ['version_id','version','edition','master','cut'];
const versionKey = row => JSON.stringify(versionFields.map(field => row[field] ?? null));
const attr = (tag, name) => {
  const match = tag.match(new RegExp('\\b'+name+'\\s*=\\s*(["\u0027])(.*?)\\1','i'));
  return match ? decodeHtmlEntities(match[2]) : null;
};

export function reconcileRadar({issue, radar, works, config}) {
  assert(issue?.week && radar?.week === issue.week, 'issue/radar week mismatch');
  assert.equal(radar.schema_version, 1, 'unsupported radar schema');
  const catalogue = Array.isArray(works) ? works : works?.works;
  assert(Array.isArray(catalogue), 'canonical catalogue required');
  assert(config?.radar_popularity && config?.radar_1080p, 'personalization config required');
  const next = structuredClone(radar), unresolved = [], removed = [], conflicts = [];
  const byId = new Map(), byTitle = new Map();
  for (const work of catalogue) {
    assert(typeof work?.id === 'string' && work.id.trim(), 'canonical catalogue entry requires a nonempty work ID');
    byId.set(work.id, [...(byId.get(work.id) || []), work]);
    for (const title of [work.title,...(work.aliases || [])]) {
      if (!title) continue;
      const key = titleKey(title), list = byTitle.get(key) || [];
      if (!list.includes(work)) list.push(work);
      byTitle.set(key, list);
    }
  }
  function resolve(row, location) {
    let matches;
    if (row.work_id) {
      matches = byId.get(row.work_id) || [];
      if (matches.length !== 1) {
        unresolved.push({location,title:row.title,work_id:row.work_id,reason:'unknown_or_non_unique_work_id'});
        return null;
      }
      const work = matches[0];
      if (row.title && ![work.title,...(work.aliases || [])].some(title => titleKey(title) === titleKey(row.title))) {
        unresolved.push({location,title:row.title,work_id:row.work_id,reason:'canonical_title_mismatch'});
        return null;
      }
    } else {
      matches = byTitle.get(titleKey(row.title)) || [];
      if (matches.length !== 1) {
        unresolved.push({location,title:row.title,reason:matches.length ? 'ambiguous_title' : 'unknown_title',possible_work_ids:matches.map(work => work.id)});
        return null;
      }
    }
    const work = matches[0];
    if (row.year !== undefined && work.year !== undefined && String(row.year) !== String(work.year)) {
      unresolved.push({location,title:row.title,work_id:work.id,reason:'canonical_year_mismatch'});
      return null;
    }
    return {id:work.id,row,location,version:versionKey(row)};
  }
  const resolved = new Map();
  for (const key of ['popular_scan','popular_deep','hd1','hd2']) {
    const pool = radar[key];
    if (!pool) continue;
    assert(Array.isArray(pool.candidates), key+' candidates must be an array');
    resolved.set(key,pool.candidates.map((row,index) => resolve(row, key+'/candidates/'+index)));
  }
  const rendered = new Map();
  for (const page of issue.pages || []) {
    if (!sectionPageMatches(page.id,'radar-1') && !sectionPageMatches(page.id,'radar-2') && !sectionPageMatches(page.id,'radar-torrent')) continue;
    const rows = [];
    for (const [index, match] of [...String(page.html || '').matchAll(/(<article\b[^>]*>)([\s\S]*?)<\/article>/gi)].entries()) {
      const heading = match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
      if (!heading) continue;
      rows.push(resolve({title:htmlText(heading[1]),work_id:attr(match[1],'data-work-id')}, page.id+'/articles/'+index));
    }
    rendered.set(page.id,rows.filter(Boolean));
  }
  const identityMap = rows => {
    const map = new Map();
    for (const row of rows.filter(Boolean)) map.set(row.id,[...(map.get(row.id) || []),row]);
    return map;
  };
  const popularityPrimary = identityMap([...rendered.entries()].filter(([id]) => sectionPageMatches(id,'radar-torrent') && id !== 'radar-torrent-sillonnage').flatMap(([,rows]) => rows));
  const popularityScan = identityMap(resolved.get('popular_scan') || []);
  const hdPrimaryByPool = new Map();
  for (const [index,key] of ['hd1','hd2'].entries()) {
    const pool = radar[key];
    const primary = [...(rendered.get('radar-'+(index+1)) || [])];
    for (const row of resolved.get(key) || []) {
      if (row && Number.isFinite(Number(row.row.rank)) && Number(row.row.rank) > 0 && Number(row.row.rank) <= Number(pool.target)) primary.push(row);
    }
    hdPrimaryByPool.set(key,identityMap(primary));
  }
  const hdPrimary = identityMap([...hdPrimaryByPool.values()].flatMap(map => [...map.values()].flat()));
  const hdSeen = new Map(), popularSeen = new Map();
  const protectedVersions = new Set();
  // An explicit version disagreement needs a human identity decision. Retain
  // every affected row rather than silently selecting which edition survives.
  const groups = identityMap([...resolved.values()].flat().filter(Boolean));
  for (const [id, rows] of groups) {
    const explicit = new Set(rows.filter(row => row.version !== versionKey({})).map(row => row.version));
    if (explicit.size > 1) {
      protectedVersions.add(id);
      conflicts.push({work_id:id,reason:'conflicting_explicit_versions',locations:rows.map(row => row.location)});
    }
  }
  function duplicate(row, references, reason, key, index) {
    if (!references?.length) return false;
    if (protectedVersions.has(row.id)) return false;
    const explicit = row.version !== versionKey({});
    const otherExplicit = references.filter(other => other.version !== versionKey({}));
    if ((explicit && (!otherExplicit.length || otherExplicit.some(other => other.version !== row.version))) || (!explicit && otherExplicit.length)) {
      conflicts.push({work_id:row.id,reason:'unverified_or_conflicting_version',locations:[row.location,...references.map(other => other.location)]});
      return false;
    }
    removed.push({pool:key,index,work_id:row.id,reason,kept_locations:references.map(other => other.location),candidate:structuredClone(row.row)});
    return true;
  }
  for (const key of ['popular_deep','hd1','hd2']) {
    const pool = next[key]; if (!pool) continue;
    const ownPrimaryKept = new Set();
    pool.candidates = pool.candidates.filter((candidate,index) => {
      const row = resolved.get(key)[index];
      if (!row) return true;
      if (key === 'popular_deep') {
        if (duplicate(row,popularityScan.get(row.id),'duplicates_popular_scan',key,index) ||
            duplicate(row,popularityPrimary.get(row.id),'duplicates_public_primary',key,index) ||
            duplicate(row,popularSeen.get(row.id),'duplicate_within_popular_deep',key,index)) return false;
        popularSeen.set(row.id,[...(popularSeen.get(row.id) || []),row]);
      } else {
        if (hdPrimaryByPool.get(key).has(row.id)) {
          const rank = Number(row.row.rank), hasRank = Number.isFinite(rank) && rank > 0;
          const isPersistedPrimary = hasRank ? rank <= Number(pool.target) : !ownPrimaryKept.has(row.id);
          if (!isPersistedPrimary && duplicate(row,hdPrimaryByPool.get(key).get(row.id),'duplicates_hd_primary_own_page',key,index)) return false;
          // This includes the persisted primary rows, which must never be pruned.
          if ([...hdPrimaryByPool.entries()].some(([other,map]) => other !== key && map.has(row.id))) conflicts.push({work_id:row.id,reason:'duplicate_hd_primaries',location:row.location});
          ownPrimaryKept.add(row.id);
          return true;
        }
        if (duplicate(row,hdPrimary.get(row.id),'duplicates_hd_primary_other_page',key,index) ||
            duplicate(row,hdSeen.get(row.id),'duplicate_hd_reserve',key,index)) return false;
        hdSeen.set(row.id,[...(hdSeen.get(row.id) || []),row]);
      }
      return true;
    });
  }
  const keptIdentity = key => {
    const removedIndices = new Set(removed.filter(row => row.pool === key).map(row => row.index));
    return (resolved.get(key) || []).filter((row,index) => row && !removedIndices.has(index));
  };
  const unique = rows => new Set(rows.map(row => row.id)).size;
  const deficits = [];
  const requirement = (scope,actual,minimum) => {
    assert(Number.isFinite(minimum) && minimum >= 0,'invalid minimum for '+scope);
    if (actual < minimum) deficits.push({scope,actual,minimum,missing:minimum-actual,requires_editorial_work:true});
  };
  requirement('popular_scan',unique(keptIdentity('popular_scan')),Number(config.radar_popularity.scan_visible));
  requirement('popular_deep',unique(keptIdentity('popular_deep')),Number(config.radar_popularity.minimum_reserve_candidates));
  const hdRows = ['hd1','hd2'].flatMap(keptIdentity);
  for (const key of ['hd1','hd2']) requirement(key,unique(keptIdentity(key)),Math.ceil(Number(config.radar_1080p.minimum_total_candidates)/2));
  requirement('hd_distinct_global',unique(hdRows),Number(config.radar_1080p.minimum_total_candidates));
  requirement('hd_usable_reserves',unique(hdRows.filter(row => !hdPrimary.has(row.id))),Math.max(0,Number(config.radar_1080p.minimum_total_candidates)-Number(config.radar_1080p.target_visible)));
  return {radar:next,report:{schema_version:1,week:issue.week,changed:removed.length > 0,removed,unresolved,conflicts,deficits,
    notice:'NON CERTIFIANT: deficits remain editorial work. Existing ranks, evidence and shortage reasons are preserved; no new candidates or certification are created.'}};
}

export function readLocalRadarContext(root, week) {
  assert.match(week || '', /^\d{4}-S\d{2}$/,'week required');
  root = fs.realpathSync(root);
  const names = {issue:`data/weeks/${week}.json`,radar:`data/radar-reserves/${week}.json`,works:'data/works.json',config:'data/personalization-config.json',manifest:'data/manifest.json',research:`data/research/${week}.json`};
  const files = {}, values = {};
  for (const [key,name] of Object.entries(names)) {
    const filename = path.join(root,name);
    if (key === 'research' && !fs.existsSync(filename)) {files[name] = null; values[key] = null; continue;}
    assert(fs.realpathSync(filename).startsWith(root+path.sep),'input must belong to local root');
    const raw = fs.readFileSync(filename,'utf8'); files[name] = raw; values[key] = JSON.parse(raw);
  }
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  return {root,week,files,values,radar_path:names.radar,input_sha:hash(JSON.stringify(files)),base_sha:git(['rev-parse','HEAD']),branch:git(['branch','--show-current'])};
}

export function applyLocalRadar(context, result, {expected_input_sha,expected_base_sha}) {
  assert.equal(expected_input_sha,context.input_sha,'expected input SHA does not match preview');
  assert.equal(expected_base_sha,context.base_sha,'expected base SHA does not match preview');
  const fresh = readLocalRadarContext(context.root,context.week);
  assert.equal(fresh.input_sha,expected_input_sha,'input changed since preview');
  assert.equal(fresh.base_sha,expected_base_sha,'HEAD changed since preview');
  assert(!['main','master'].includes(fresh.branch),'local apply is forbidden on main/master');
  assert.equal(fresh.values.issue.publication_status,'draft','only local draft issues can be changed');
  assert(!fresh.values.manifest?.weeks?.some(entry => entry.week === context.week && entry.status === 'published'),'published manifest week cannot be changed');
  assert(!['sealed','approved','ready'].includes(fresh.values.research?.stage) && !fresh.values.research?.editorial_review_completed && !fresh.values.research?.reviewed_files &&
    fresh.values.research?.editorial_review?.completed !== true && !fresh.values.research?.editorial_review?.reviewed_files,'sealed editorial review cannot be changed');
  const currentResult = reconcileRadar(fresh.values);
  assert.deepEqual(result,currentResult,'result does not match exact current inputs');
  if (!result.report.changed) return false;
  const filename = path.join(fresh.root,fresh.radar_path), temporary = filename+'.reconcile-'+process.pid+'.tmp';
  try {
    fs.writeFileSync(temporary,JSON.stringify(result.radar,null,2)+'\n',{flag:'wx'});
    const finalContext = readLocalRadarContext(fresh.root,fresh.week);
    assert.equal(finalContext.input_sha,expected_input_sha,'input changed before write');
    assert.equal(finalContext.base_sha,expected_base_sha,'HEAD changed before write');
    fs.renameSync(temporary,filename);
  } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
  return true;
}

export function main(args = process.argv.slice(2)) {
  const [week,...rest] = args, options = {root:process.cwd()}, accepted = new Set(['--root','--expected-input-sha','--expected-base-sha','--json','--apply-plan']);
  let apply = false;
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index];
    if (option === '--apply') {assert(!apply,'duplicate --apply');apply = true;continue;}
    assert(accepted.has(option) && rest[index+1],'Usage: WEEK [--root ROOT] [--json PLAN.json] [--apply-plan PLAN.json | --apply --expected-input-sha SHA256 --expected-base-sha COMMIT]');
    assert(options[option] === undefined,'duplicate option');options[option] = rest[++index];
  }
  if (options['--json']) assert(!fs.existsSync(options['--json']),'output already exists; choose a new preview filename');
  const context = readLocalRadarContext(options['--root'] || options.root,week), result = reconcileRadar(context.values);
  let applied = false;
  if (options['--apply-plan']) {
    assert(!apply && !options['--expected-input-sha'] && !options['--expected-base-sha'],'choose apply-plan or explicit hashes');
    const plan = JSON.parse(fs.readFileSync(options['--apply-plan'],'utf8'));
    assert.equal(plan.week,week,'preview week mismatch');
    assert.equal(plan.mode,'preview','apply-plan requires an unmodified preview report');
    assert.deepEqual({...plan,input_sha:undefined,base_sha:undefined,mode:undefined,applied:undefined},{...result.report,input_sha:undefined,base_sha:undefined,mode:undefined,applied:undefined},'preview report does not match current reconciliation');
    options['--expected-input-sha'] = plan.input_sha; options['--expected-base-sha'] = plan.base_sha; apply = true;
  }
  if (apply) applied = applyLocalRadar(context,result,{expected_input_sha:options['--expected-input-sha'],expected_base_sha:options['--expected-base-sha']});
  const report = {...result.report,mode:apply ? 'local_apply' : 'preview',applied,input_sha:context.input_sha,base_sha:context.base_sha};
  if (options['--json']) fs.writeFileSync(options['--json'],JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
