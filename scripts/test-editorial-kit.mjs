import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {channelDisplay, channelMatcher, dossierForWork, inventorySlot, loadDossiers, remoteImage, teleramaReview, weekDates, workDir}
  from './editorial-kit-common.mjs';
import {applyWorkPlan, candidateOverview, fillResolverGaps, normalizePicks, picksWorkPlan, recentTitles, sectionWorkPlan} from './editorial-kit-catalogue.mjs';
import {buildDayPlan, buildSectionPlan, orderDailyRows, sectionReserveMinimum} from './editorial-kit-plans.mjs';
import {applyGridReview, buildCoveragePass, buildShortlist, initialResearch, mergeReviewNotes} from './editorial-kit-records.mjs';
import {checkProgressStructures} from './editorial-progress.mjs';
import {parseCli} from './editorial-kit.mjs';
import {buildDraftBundle} from './editorial-draft-cards.mjs';
import {checkShortlist} from './editorial-progress.mjs';

const fixtures = new URL('./fixtures/editorial-kit/', import.meta.url);
const fixture = name => JSON.parse(fs.readFileSync(new URL(name, fixtures), 'utf8'));
const work = () => workDir(fileURLToPath(new URL('work/', fixtures)));
const WEEK = '2026-S53', SHA = 'c'.repeat(40), PDF = 'a'.repeat(64);
const dates = weekDates(WEEK);
const context = () => ({week: WEEK, sha: SHA, remaining: ['Terminer les rubriques et revoir la candidate complète.'],
  works: fixture('works.json').works, inventory: fixture('inventory.json'), editorial: fixture('telerama-editorial.json'), pdfSha: PDF});
const workPlan = () => picksWorkPlan({picks: normalizePicks(fixture('work/picks.json'), dates), dossiers: work().dossiers(), catalogue: fixture('works.json').works});
const dayPlan = (options = {}) => {
  const dir = work();
  return buildDayPlan(context(), {rows: workPlan(), copyFor: dir.copyFor, dossiers: dir.dossiers(), sameChannel: dir.sameChannel,
    displayChannel: dir.displayChannel, checked: '2026-12-23', issueNumber: '9999', ...options});
};
const draftContext = () => {
  const manifest = {schema_version: 1, latest: '2026-S52', weeks: [{week: '2026-S52', status: 'published'}]};
  const saved = value => JSON.stringify(value, null, 2) + '\n';
  const raw = new Map([['data/manifest.json', saved(manifest)], ['data/works.json', saved(fixture('works.json'))], ['data/links.json', saved({links: {}})]]);
  return {sha: SHA, manifest, works: fixture('works.json'), links: {links: {}}, issue: null, shell: null, read: name => raw.get(name) ?? null,
    asset_version: null, radar_reserves: null};
};

test('week dates come from the ISO week, across a year boundary, with a French range', () => {
  assert.deepEqual([dates.from, dates.to], ['2026-12-26', '2027-01-01']);
  assert.equal(dates.range, '26 décembre 2026 au 1er janvier 2027');
  assert.equal(weekDates('2026-S45').range, '31 octobre au 6 novembre 2026');
  assert.equal(weekDates('2026-S44').range, '24 au 30 octobre 2026');
  assert.equal(dates.dateOf('vendredi'), '2027-01-01');
  assert.throws(() => weekDates('2027-S53'), /does not exist/);
  assert.throws(() => dates.dayOf('2027-01-02'), /outside issue/);
});

test('channels match only through explicit aliases', () => {
  const same = channelMatcher({'LCP-Assemblée nationale': 'LCP'});
  assert(same('LCP-Assemblée nationale', 'LCP'));
  assert(!same('Canal+', 'Canal+ Cinéma'));
  assert.equal(channelDisplay({'LCP-Assemblée nationale': 'LCP'})('LCP'), 'LCP-Assemblée nationale');
  assert.equal(channelDisplay({})('Arte'), 'Arte');
});

test('inventory slots match the printed title, or a single row when the card title is in the original language', () => {
  const inventory = fixture('inventory.json');
  assert.equal(inventorySlot(inventory, {date: '2026-12-26', time: '21:00', channel: 'Arte', titles: ['Film A']}).basis, 'title');
  const vo = inventorySlot(inventory, {date: '2026-12-27', time: '20:50', channel: 'Ciné+ OCS', titles: ['The Original Title']});
  assert.equal(vo.basis, 'single_row');
  assert.equal(vo.item.title, 'Le Titre imprimé');
  assert.equal(inventorySlot(inventory, {date: '2026-12-28', time: '22:00', channel: 'Arte', titles: ['Z']}).basis, 'ambiguous');
  assert.equal(inventorySlot(inventory, {date: '2026-12-26', time: '21:00', channel: 'Canal+ Cinéma', titles: ['Encore un film']}).basis, 'absent');
  assert.equal(inventorySlot(inventory, {date: '2026-12-26', time: '16:40', channel: 'Arte', titles: ['Guinée-Bissau, l’île sanctuaire']}).basis, 'title');
});

test('Télérama reviews match by slot when the official title differs, never by title alone', () => {
  const editorial = fixture('telerama-editorial.json'), same = channelMatcher({'LCP-Assemblée nationale': 'LCP'});
  assert.equal(teleramaReview(editorial, {date: '2026-12-26', time: '21:00', channel: 'Arte', titles: ['Film A']}).basis, 'title');
  const official = teleramaReview(editorial, {date: '2027-01-01', time: '00:30', channel: 'LCP-Assemblée nationale', titles: ['Documentaire B : le titre officiel']}, same);
  assert.deepEqual([official.basis, official.index], ['slot', 1]);
  const shifted = teleramaReview(editorial, {date: '2026-12-27', time: '20:50', channel: 'Ciné+ OCS', titles: ['Le Titre imprimé']});
  assert.deepEqual([shifted.basis, shifted.index], ['title_channel', 2]);
  assert.equal(teleramaReview(editorial, {titles: ['Film A']}), null);
  assert.equal(teleramaReview(editorial, {date: '2026-12-26', time: '21:00', channel: 'France 2', titles: ['Autre']}), null);
});

test('a localized poster renders from its remote original', () => {
  const [film, other] = fixture('works.json').works;
  assert.equal(remoteImage(film), 'https://media.example.org/film-a.jpg');
  assert.equal(remoteImage(other), null);
  assert.throws(() => remoteImage({id: 'x', image: 'assets/posters/x.webp'}), /without a remote original/);
});

test('picks map to canonical works by exact link; a bare title clash is never reused', () => {
  const rows = workPlan();
  assert.deepEqual(rows.map(row => [row.work_id, row.status, row.basis]), [
    ['film-a-1950', 'existing', 'link'], ['the-original-title-2020', 'existing', 'link'], ['documentaire-b-2026', 'existing', 'explicit']]);
  assert.equal(rows[1].date, '2026-12-27');
  const catalogue = fixture('works.json').works, dossiers = work().dossiers();
  const extra = picksWorkPlan({picks: normalizePicks([{date: '2026-12-29', time: '21:00', channel: 'Arte', printed: 'Nouveau film'},
    {date: '2026-12-29', time: '23:00', channel: 'Arte', printed: 'Copie conforme'}, {date: '2026-12-30', time: '21:00', channel: 'Arte', printed: 'Sans dossier'},
    {date: '2026-12-30', time: '23:00', channel: 'Arte', printed: 'Nouveau film'}], dates), dossiers, catalogue});
  assert.deepEqual(extra.map(row => [row.work_id, row.status]), [['nouveau-film-2025', 'new'], [null, 'clash'], [null, 'needs_dossier'], ['nouveau-film-2025', 'repeat']]);
  assert.deepEqual([extra[3].date, extra[3].time, extra[3].primary], ['2026-12-30', '23:00', false]);
  assert.deepEqual(extra[1].clash, ['copie-conforme-1947']);
  const applied = applyWorkPlan(catalogue, extra);
  assert.deepEqual(applied.added, ['nouveau-film-2025']);
  assert.deepEqual(catalogue.at(-1), {id: 'nouveau-film-2025', title: 'Nouveau film', aliases: ['New Film'],
    links: {sc: 'https://www.senscritique.com/film/film_104/104', imdb: 'https://www.imdb.com/title/tt0000104/'}});
});

test('section intake adds missing link keys and reports a different saved link', () => {
  const catalogue = fixture('works.json').works;
  const entries = loadDossiers(fileURLToPath(new URL('work/dossiers/', fixtures))).filter(entry => entry._file === 'RAD.json');
  const rows = sectionWorkPlan({entries, catalogue});
  assert.deepEqual(rows.map(row => [row.work_id, row.status]), [['film-a-1950', 'existing']]);
  rows[0].links = {sc: 'https://www.senscritique.com/film/autre/9', official: 'https://www.example.org/film-a'};
  const applied = applyWorkPlan(catalogue, rows);
  assert.deepEqual(applied.linked, ['film-a-1950.official']);
  assert.equal(applied.conflicts.length, 1);
  assert.equal(catalogue[0].links.sc, 'https://www.senscritique.com/film/film_101/101');
});

test('resolver gaps take the SensCritique duration, the year matching the ID and the dossier country', () => {
  const catalogue = [{id: 'film-a-1950', title: 'Film A', links: {sc: 'https://www.senscritique.com/film/film_101/101', imdb: 'https://www.imdb.com/title/tt0000101/'}, director: 'R', genre: 'Drame', image: 'https://x/y.jpg'}];
  const report = {generated_at: '2026-12-23T09:00:00Z', results: [{work_id: 'film-a-1950', expected_year: 1950, fields: {
    duration: {status: 'conflict', sources: [{source: 'senscritique', value: '91 min', source_url: 'https://www.senscritique.com/film/film_101/101'}, {source: 'wikidata', value: '95 min'}]},
    year: {status: 'conflict', sources: [{source: 'senscritique', value: '1951', source_url: 'https://www.senscritique.com/film/film_101/101'}, {source: 'wikidata', value: '1950', source_url: 'https://www.wikidata.org/wiki/Q101'}]}}}]};
  const result = fillResolverGaps(catalogue, report, work().dossiers());
  assert.equal(catalogue[0].duration, '91 min (SensCritique ; wikidata 95 min)');
  assert.equal(catalogue[0].year, 1950);
  assert.equal(catalogue[0].metadata_prefill.fields.year, 'https://www.wikidata.org/wiki/Q101');
  assert.equal(catalogue[0].country, 'France / Italie');
  assert.match(catalogue[0].metadata_prefill.fields.country, /^dossier:/);
  assert.deepEqual(result.missing, []);
});

test('candidate overview ranks by native appreciation and flags recent and catalogue titles', () => {
  const recent = recentTitles({week: WEEK, manifest: {weeks: [{week: '2026-S52', status: 'published'}, {week: '2026-S53', status: 'draft'}]},
    readIssue: week => ({'2026-S52': {pages: [{html: '<article data-title="X">'}], personalization: {pools: {}}}})[week], works: [], lookback: 4});
  const overview = candidateOverview({telerama: {observations: [{title: 'X', date: '2026-12-28', start: '22:00', channel: 'Arte'},
    {title: 'Film A', date: '2026-12-26', start: '21:00', channel: 'Arte'}, {title: 'Inconnu', date: '2026-12-29', start: '20:00', channel: 'TF1'}]},
    editorial: fixture('telerama-editorial.json'), gridRatings: {2: 'TT'}, history: recent.history, works: fixture('works.json').works});
  assert.deepEqual(overview.rows.map(row => row.title), ['Film A', 'Inconnu', 'X']);
  assert.match(overview.text, /^Film A \[\?\] REV:Très bien CAT:film-a-1950/);
  assert.match(overview.text, /X \[\?\] REV:Bof HIST:S52/);
});

test('daily ranks put primaries first, or follow explicit ranks', () => {
  const rows = [{date: '2026-12-26', title: 'b'}, {date: '2026-12-26', title: 'a', primary: true}, {date: '2026-12-27', title: 'c'}];
  assert.deepEqual(orderDailyRows(rows).map(row => [row.title, row.rank]), [['a', 1], ['b', 2], ['c', 1]]);
  assert.deepEqual(orderDailyRows([{date: '2026-12-26', title: 'x', rank: 2}, {date: '2026-12-26', title: 'y', rank: 1}]).map(row => row.title), ['y', 'x']);
  const repeat = orderDailyRows([{date: '2026-12-26', title: 'a', primary: true}, {date: '2026-12-28', title: 'a', status: 'repeat'}]);
  assert.deepEqual(repeat.map(row => [row.date, row.rank]), [['2026-12-26', 1], ['2026-12-28', 1]], 'a rebroadcast keeps its own card');
});

test('the day plan states matched provenance, renders the poster from its remote URL and passes the draft checks', () => {
  const {plan, report} = dayPlan();
  assert.deepEqual(report.problems, []);
  assert.equal(plan.source_sha, SHA);
  assert.equal(plan.range, '26 décembre 2026 au 1er janvier 2027');
  const [film, original, doc] = plan.cards;
  assert.deepEqual(film.work, {image: 'https://media.example.org/film-a.jpg'});
  assert.equal(original.work, undefined);
  assert.equal(doc.channel, 'LCP-Assemblée nationale');
  assert.match(film.review.current_broadcast, new RegExp(`^Grille du Télérama n° 9999 fourni \\(sha256:${PDF}#page=10\\) : 2026-12-26 21:00 Arte`));
  assert.match(film.review.editorial_copy, /critique Télérama relue p\. 20 \(\/reviews\/0\)/);
  assert.match(original.review.editorial_copy, /\/reviews\/2/);
  assert.match(doc.review.editorial_copy, /\/reviews\/1/);
  assert.match(film.review.identity_version, /^Version de 1950, pas le remake\. Identité 1950 de Réalisation Film A rapprochée de la ligne imprimée Télérama p\. 10\./);
  assert.match(film.review.canonical_fields, /work-resolver le 2026-12-20 depuis senscritique\.com, wikidata\.org/);
  assert.equal(film.grid_reason, 'Ligne de grille de Film A.');
  assert.equal(dayPlan({gridRanks: 0}).plan.cards[0].grid_reason, undefined);
  const {bundle, report: draft} = buildDraftBundle(draftContext(), plan);
  assert.equal(draft.authored_cards, 3);
  const issue = JSON.parse(bundle.files.find(file => file.path === `data/weeks/${WEEK}.json`).content);
  assert.deepEqual(Object.keys(issue.personalization.pools).sort(), ['samedi-selection', 'dimanche-selection', 'vendredi-selection'].sort());
});

test('a slot absent from the inventory needs an authored broadcast proof', () => {
  const dir = work(), rows = workPlan();
  rows[0] = {...rows[0], time: '20:00'};
  const {plan, report} = buildDayPlan(context(), {rows, copyFor: dir.copyFor, dossiers: dir.dossiers(), sameChannel: dir.sameChannel, checked: '2026-12-23'});
  assert.equal(plan.cards.length, 2);
  assert.match(report.problems[0], /créneau absent de l'inventaire/);
  const proof = 'Programme officiel Arte lu le 2026-12-23 : diffusion à 20:00.';
  const copyFor = (id, ...titles) => id === 'film-a-1950' ? {...dir.copyFor(id), review: {current_broadcast: proof}} : dir.copyFor(id, ...titles);
  const kept = buildDayPlan(context(), {rows, copyFor, dossiers: dir.dossiers(), sameChannel: dir.sameChannel, checked: '2026-12-23'});
  assert.equal(kept.plan.cards[0].review.current_broadcast, proof);
});

test('section plans read the dossier facts, keep the reserve minimum and refuse an ambiguous dossier', () => {
  const dir = work(), day = dayPlan().plan;
  const base = {works: fixture('works.json').works, week: WEEK, sha: SHA, remaining: ['Revoir la candidate.']};
  const header = {kicker: 'K', h1: 'H', deck: 'D'};
  const pconfig = {section_reserve_pools: {sections: {weekly_rendezvous: {page_id_prefix: 'rendezvous-', card_type: 'week-card', minimum_reserve_per_page: 1}}},
    radar_1080p: {minimum_total_candidates: 16}};
  const options = spec => ({spec, copyFor: dir.copyFor, dossiers: dir.dossiers(), dayPlan: day, checked: '2026-12-23', pconfig});
  assert.equal(sectionReserveMinimum('rendezvous-1', 'rendezvous', 5, JSON.parse(fs.readFileSync('data/personalization-config.json', 'utf8'))), 10);
  assert.throws(() => buildSectionPlan(base, options({sections: [{kind: 'rendezvous', page: 1, target: 1, header, cards: [{work_id: 'film-a-1950'}]}]})), /il en faut 2/);
  const rdv = buildSectionPlan(base, options({sections: [{kind: 'rendezvous', page: 1, target: 1, header,
    cards: [{work_id: 'the-original-title-2020'}, {work_id: 'film-a-1950'}]}]})).plan.sections[0];
  assert.deepEqual(rdv.cards.map(card => [card.work_id, card.rank, card.grid_reason]), [['the-original-title-2020', 1, undefined], ['film-a-1950', 2, undefined]]);
  assert.deepEqual(rdv.cards[1].work, {image: 'https://media.example.org/film-a.jpg'});
  const hd = buildSectionPlan(base, options({sections: [{kind: 'radar_hd', page: 1, header, cards: [{dossier: 'RAD.json', key: 'hd', query: 'Film A'}]}]}));
  assert.equal(hd.plan.sections[0].cards[0].added, 'Édition 4K, 29 décembre 2026');
  assert.equal(hd.plan.sections[0].cards[0].added_source_url, 'https://www.avcesar.com/film-a');
  assert.match(hd.plan.sections[0].cards[0].review.current_broadcast, /^Édition lue le 2026-12-23 sur https:\/\/www\.avcesar\.com\/film-a/);
  const release = {kind: 'physical_release', page: 1, target: 1, header, cards: [{work_id: 'film-a-1950', quality: 'PATRIMOINE'}]};
  assert.throws(() => buildSectionPlan(base, options({sections: [release]})), /RUB\.json, RUB2\.json.*name the dossier file/);
  const physical = buildSectionPlan(base, options({sections: [{...release, dossier: 'RUB2.json'}]})).plan.sections[0].cards[0];
  assert.deepEqual(physical.release, {date: '2026-12-29', format: '4K UHD + Blu-ray', editor: 'Éditeur', url: 'https://shop.example.org/film-a',
    checked_at: '2026-12-23', restoration: 'Restauration 4K'});
  const long = buildSectionPlan(base, {...options({sections: [{kind: 'radar_hd', page: 1, header, cards: [{dossier: 'RAD.json', query: 'Film A', why: 'x'.repeat(600)}]}]}), settings: {radar_card_max_chars: 500}});
  assert.match(long.report.warnings[0], /radar-1 film-a-1950: \d+ caractères visibles/);
  const replaced = buildSectionPlan(base, {...options({sections: [{kind: 'radar_hd', page: 1, header, cards: [{dossier: 'RAD.json', query: 'Film A'}]}]}), existingPages: ['radar-1', 'radar-2']});
  assert.deepEqual(replaced.plan.replace_pages, ['radar-1']);
});

test('review notes fill the extraction, keep the raw title and refuse an unmatched note', () => {
  const raw = fixture('telerama-editorial.raw.json'), notes = fixture('work/review-notes.json');
  const {report, unreviewed} = mergeReviewNotes(raw, notes, {now: '2026-12-23T10:00:00Z'});
  assert.deepEqual(unreviewed, ['p. 21 Non lue']);
  const [film, fixed, unread] = report.reviews;
  assert.equal(film.reviewed_title, undefined);
  assert.deepEqual([fixed.title, fixed.reviewed_title, fixed.author, fixed.summary_reviewed], ['Trois Pères et un bébé La Chimè', 'Trois Pères et un bébé', 'Critique B', true]);
  assert.match(fixed.summary_basis, /titre brut conservé/);
  assert.equal(unread.summary_reviewed, false);
  assert.equal(report.summary.summaries_reviewed, 2);
  assert.deepEqual(report.warnings, ['Avertissement du parseur.', 'Critique à avis partagés non importée.']);
  assert.equal(raw.reviews[0].author, null);
  assert.throws(() => mergeReviewNotes(raw, {reviews: [{pdf_page: 99, title: 'Ailleurs', author: 'A', summary: 'S'}]}, {now: 'x'}), /matching no extracted review/);
  assert.throws(() => mergeReviewNotes(raw, {reviews: [{pdf_page: 20, title: 'Film A', author: 'A', summary: 's'.repeat(701)}]}, {now: 'x'}), /over 700/);
});

test('the grid review corrects and adds rows in the inventory and keeps the publication thresholds', () => {
  const inventory = fixture('inventory.json');
  const result = applyGridReview(inventory, fixture('coverage.json'), fixture('work/grid-review.json'));
  const titles = result.inventory.days.flatMap(day => day.items.map(item => item.title));
  assert(titles.includes('Stade 2 la quotidienne') && titles.includes('L’Affaire du siècle') && titles.includes('Guinée-Bissau, l’île sanctuaire'));
  const added = result.inventory.days.find(day => day.date === '2026-12-29').items[0];
  assert.deepEqual([added.title, added.pdf_page, added.bbox, added.source_ref], ['Programme oublié', 13, [20, 60, 90, 68], 'sha256:' + PDF]);
  assert.equal(result.inventory.days.find(day => day.date === '2026-12-29').channel_counts['France 5'], 1);
  const review = result.coverage.grid_inventory.transcription_review;
  assert.deepEqual(review.corrections_applied, {page_corrections: 1, global_corrections: 2, rows_added: 1});
  assert.equal(result.coverage.grid_inventory.rows, 11);
  assert(review.discrepancies.some(line => /\(ligature « ff » perdue\) hors pages relues : 2 titres corrigés/.test(line)));
  assert(review.discrepancies.some(line => /^Créneau à deux titres Arte 2026-12-28 22:00 \(X \/ Y\) : .*conservées\.$/.test(line)));
  assert.equal(review.discrepancies.at(-1), 'Revue d’impact : aucune proposition retenue n’est touchée.');
  assert(result.errors.some(error => /at least 35 sampled rows/.test(error)), 'a short review never passes the transcription thresholds');
  assert.equal(inventory.days[1].items[0].title, 'Stade 2 la');
});

test('the shortlist cites committed review pointers, records compact evidence and keeps saved leads', () => {
  const dir = work(), {bundle} = buildDraftBundle(draftContext(), dayPlan().plan);
  const issue = JSON.parse(bundle.files.find(file => file.path === `data/weeks/${WEEK}.json`).content);
  const research = {schema_version: 1, week: WEEK, remaining: ['x'], shortlist: {entries: [
    {id: 'lead', title: 'Piste', scope: {day: 'lundi'}, status: 'to_research', signals: [{kind: 'critique', note: 'n', source_url: 'https://www.example.org/'}]},
    {id: 'sl-samedi-selection-ancien', title: 'Ancien', scope: {day: 'samedi'}, status: 'card_drafted', signals: []}]}, verification_records: []};
  const result = buildShortlist({week: WEEK, dates, issue, works: fixture('works.json').works, editorial: fixture('telerama-editorial.json'), editorialSha: 'e'.repeat(40),
    inventory: fixture('inventory.json'), pdfSha: PDF, research}, {decisions: fixture('work/decisions.json'), dossiers: dir.dossiers(),
    sameChannel: dir.sameChannel, checked: '2026-12-23', now: '2026-12-23T12:00:00Z'});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.problems, []);
  const entries = result.research.shortlist.entries;
  assert.deepEqual(entries.map(entry => entry.id), ['lead', 'sl-samedi-selection-film-a-1950', 'sl-dimanche-selection-the-original-title-2020',
    'sl-vendredi-selection-documentaire-b-2026', 'sl-x-piste-ecartee']);
  assert.deepEqual(result.report.dropped, ['sl-samedi-selection-ancien']);
  const doc = entries.find(entry => entry.work_id === 'documentaire-b-2026');
  assert.deepEqual(doc.signals[0].provenance, {source_sha: 'e'.repeat(40), path: `data/editorial-inputs/${WEEK}/telerama-editorial.json`, json_pointer: '/reviews/1'});
  assert.equal(doc.decision_note, 'vendredi-selection rang 1 (00:30 LCP-Assemblée nationale) ; carte rédigée le 2026-12-23.');
  const broadcast = result.research.verification_records.filter(record => record.field === 'broadcast.start');
  assert.deepEqual(broadcast.map(record => record.url), [`sha256:${PDF}#page=10`, `sha256:${PDF}#page=12`, `sha256:${PDF}#page=14`]);
  const identity = result.research.verification_records.find(record => record.field === 'identity' && record.work_id === 'film-a-1950');
  assert.equal(identity.checked_at, '2026-12-23T09:15:00Z');
  assert.doesNotThrow(() => checkShortlist(result.research));
  const again = buildShortlist({week: WEEK, dates, issue, works: fixture('works.json').works, editorial: fixture('telerama-editorial.json'), editorialSha: 'e'.repeat(40),
    inventory: fixture('inventory.json'), pdfSha: PDF, research: result.research}, {dossiers: dir.dossiers(), sameChannel: dir.sameChannel, checked: '2026-12-23', now: '2026-12-23T13:00:00Z'});
  assert.equal(again.report.new_records, 0, 'records are not duplicated on a rerun');
  const unsourced = buildShortlist({week: WEEK, dates, issue, works: fixture('works.json').works, editorial: {reviews: []}, editorialSha: null,
    inventory: fixture('inventory.json'), pdfSha: PDF, research}, {dossiers: [], sameChannel: dir.sameChannel, checked: '2026-12-23', now: '2026-12-23T12:00:00Z'});
  assert.equal(unsourced.problems.filter(problem => /aucun signal sourcé/.test(problem)).length, 3);
  assert.match(unsourced.errors[0], /sourced editorial signal/);
});

test('the coverage pass places reviews by slot and leaves undecided reviews open', () => {
  const dir = work(), {bundle} = buildDraftBundle(draftContext(), dayPlan().plan);
  const issue = JSON.parse(bundle.files.find(file => file.path === `data/weeks/${WEEK}.json`).content);
  const ctx = {week: WEEK, dates, issue, editorial: fixture('telerama-editorial.json'), coverage: fixture('coverage.json'), inventory: fixture('inventory.json')};
  const run = decisions => buildCoveragePass(ctx, {docDossier: JSON.parse(fs.readFileSync(new URL('work/dossiers/DOC.json', fixtures), 'utf8')),
    decisions, checked: '2026-12-23', sameChannel: dir.sameChannel});
  const result = run(fixture('work/decisions.json'));
  assert.deepEqual(result.open, ['critique /reviews/3 « X » (Bof, 2026-12-28 22:00 Arte)']);
  const pass = result.coverage.documentary_pass;
  assert.deepEqual(pass.retained, [{title: 'Documentaire B', placements: ['vendredi-selection rang 1 (00:30 LCP-Assemblée nationale)']}]);
  assert.deepEqual(pass.examined_not_retained, [{title: 'Doc non retenu', slots: ['2026-12-29 21:00 France 5'], decision: 'Non retenu : aucune critique trouvée.'}]);
  assert.equal(pass.additional_proposals.length, 1);
  assert.deepEqual(pass.distribution, {daily_cards: 3, daily_distinct_works: 3, documentary_cards: 1, documentary_distinct_works: 1, note: 'Dominante cinéma sans quota.'});
  const reminder = result.coverage.editorial_reminder.decisions;
  assert.equal(reminder[1].decision, 'retenu : vendredi-selection rang 1 (00:30 LCP-Assemblée nationale), sous le titre « Documentaire B : le titre officiel »');
  assert.equal(reminder[2].decision, 'retenu : dimanche-selection rang 1 (20:50 Ciné+ OCS), sous le titre « The Original Title »');
  const closed = run({...fixture('work/decisions.json'), reasons: {'Doc non retenu': 'Non retenu.', '/reviews/3': 'Non retenu : Télérama « Bof ».'}});
  assert.deepEqual(closed.open, []);
  assert.throws(() => run({}), /scope and limits/);
});

test('the research checkpoint starts from the week, its PDF and the public issue', () => {
  const research = initialResearch({week: WEEK, range: 'du ' + dates.range, baseSha: SHA, pdfSha: PDF, latest: '2026-S52', now: '2026-12-23T09:00:00Z'});
  assert.equal(research.remaining.length, 12);
  assert.match(research.remaining[0], new RegExp(`du 26 décembre 2026 au 1er janvier 2027 .*empreinte sha256:${PDF}`));
  assert.match(research.remaining[9], /manifest.latest à 2026-S52 et tous les statuts 2026-S53 en draft/);
  assert.deepEqual([research.stage, research.base_sha, research.resume.candidate_branch], ['inventory', SHA, 'auto/2026-S53']);
  assert.doesNotThrow(() => checkProgressStructures(research));
  assert.throws(() => initialResearch({week: WEEK, range: 'x', baseSha: SHA, pdfSha: null, latest: '2026-S52', now: 'x'}), /PDF SHA-256/);
});

test('the command line names its command, week and work directory', () => {
  assert.deepEqual(parseCli(['init', WEEK]), {command: 'init', week: WEEK, ref: 'HEAD'});
  assert.deepEqual(parseCli(['day-plan', WEEK, '--work', 'w', '--days', 'samedi', '--replace']),
    {command: 'day-plan', week: WEEK, ref: 'HEAD', work: 'w', days: 'samedi', replace: true});
  assert.equal(parseCli(['section-plan', WEEK, '--work', 'w', '--day-plan', 'out/p.json']).dayPlan, 'out/p.json');
  assert.throws(() => parseCli(['publish', WEEK, '--work', 'w']), /Usage/);
  assert.throws(() => parseCli(['render', WEEK]), /--work DIR required/);
  assert.throws(() => parseCli(['render', WEEK, '--work', 'w', '--force']), /unknown flag/);
});

test('the kit carries no week, PDF, issue number or authored text of a past production', () => {
  for (const name of ['editorial-kit.mjs', 'editorial-kit-common.mjs', 'editorial-kit-catalogue.mjs', 'editorial-kit-plans.mjs', 'editorial-kit-records.mjs', 'editorial-telerama-kit.py']) {
    const source = fs.readFileSync(new URL(name, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\b20\d\d-S\d\d\b|\b[a-f0-9]{40,64}\b|\b(?:4007|4008)\b|\d{2}\/\d{2}\/20\d\d/, name);
  }
});

test('the work directory merges copy files and refuses a text written twice', () => {
  const dir = work();
  assert.equal(dir.copyFor('film-a-1950').quality, 'PATRIMOINE');
  assert.equal(dir.copyFor('documentaire-b-2026', 'Documentaire B : le titre officiel').quality, 'DOC');
  assert.equal(dir.settings.issue_number, '9999');
  assert.equal(dossierForWork(dir.dossiers(), fixture('works.json').works[0], {keys: ['works']})._file, 'F1.json');
});
