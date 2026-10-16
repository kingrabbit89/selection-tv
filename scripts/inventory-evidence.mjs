// Evidence accepted for raw inventory rows and their per-day source lists.
// Web rows cite an http(s) page. From `quality_gates.telerama_grid_authority_from_week`,
// an inventory whose mode is "telerama-grid-authority" may instead cite the
// week's provided Télérama PDF: the same SHA-256 as
// data/editorial-inputs/<week>/telerama.json (saved on main by a normal PR),
// a PDF page and a glyph bbox. The thresholds (rows per day, nights, required
// channels, counts, duplicates) are unchanged; only the kind of proof differs,
// and every row must carry it.
export const GRID_AUTHORITY_MODE = 'telerama-grid-authority';
const HTTP = /^https?:\/\//i;
const PAGE_REF = /^(sha256:[a-f0-9]{64})#page=([1-9]\d*)$/;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const text = value => typeof value === 'string' ? value : value?.url;

export function gridAuthority({week, inventory, config, teleramaInput}) {
  if (inventory?.mode !== GRID_AUTHORITY_MODE) return {authority: null, error: null};
  const from = config?.quality_gates?.telerama_grid_authority_from_week;
  if (!from || !(week >= from)) return {authority: null, error: `Télérama grid authority is not enabled for ${week}`};
  const sha = teleramaInput?.source?.sha256;
  if (!/^[a-f0-9]{64}$/.test(String(sha || ''))) return {authority: null, error: `Télérama grid authority requires data/editorial-inputs/${week}/telerama.json with its PDF SHA-256`};
  if (teleramaInput.week !== week) return {authority: null, error: 'Télérama input belongs to another week'};
  return {authority: {source_ref: 'sha256:' + sha}, error: null};
}

export const pageRef = (authority, page) => `${authority.source_ref}#page=${page}`;

export function itemEvidenceError(item, authority) {
  if (HTTP.test(String(item?.source_url || ''))) return null;
  if (!authority) return 'source_url missing';
  if (item.source_type !== 'telerama_pdf') return 'source_url or Télérama PDF evidence missing';
  if (item.source_ref !== authority.source_ref) return 'Télérama PDF evidence belongs to another file';
  if (!Number.isInteger(item.pdf_page) || item.pdf_page < 1) return 'Télérama PDF page missing';
  if (!Array.isArray(item.bbox) || item.bbox.length !== 4 || !item.bbox.every(Number.isFinite)) return 'Télérama PDF position missing';
  return null;
}

export function sourceRefError(value, authority) {
  if (HTTP.test(String(text(value) || ''))) return null;
  if (!authority) return 'http(s) source required';
  const match = PAGE_REF.exec(String(text(value) || ''));
  if (!match || match[1] !== authority.source_ref) return 'Télérama PDF page reference expected';
  return null;
}

// Source diversity: web inventories still need two distinct domains per day.
// A grid-authority day instead needs the provided PDF among its pages; ordinary
// Web complements (for hours the magazine does not print) remain allowed.
export function sourceDiversityError(sources, authority) {
  if (authority) {
    if (sources.some(value => sourceRefError(value, authority) !== null)) return 'grid-authority source pages must be provided Télérama PDF pages or http(s) pages';
    return sources.some(value => !HTTP.test(String(text(value) || ''))) ? null : 'grid-authority day cites no page of the provided Télérama PDF';
  }
  const hosts = new Set(sources.map(value => {try {return new URL(text(value)).hostname.replace(/^www\./, '');} catch {return '';}}).filter(Boolean));
  return hosts.size < 2 ? 'two distinct source domains required for source diversity; independence is reviewed separately' : null;
}

export const inventoryRowKey = (date, row) => [date, norm(row.channel), row.start || row.time, norm(row.title)].join('|');

// Keys and cited pages used to tie the sampled review to the saved inventory.
export function inventoryReviewIndex(inventory, authority) {
  const keys = new Set(), pages = new Set();
  for (const day of inventory?.days || []) for (const item of day.items || []) {
    keys.add(inventoryRowKey(day.date, item));
    if (item.source_ref === authority?.source_ref && Number.isInteger(item.pdf_page)) pages.add(item.pdf_page);
  }
  return {keys, pages};
}

// The coverage audit of a grid-authority week is the full-grid extraction plus
// a transcription review by sampling, recorded in coverage.grid_inventory: rows
// re-read on the page (matches, corrected in the inventory, or added because
// the extraction missed them), whole pages re-read for omissions, and the
// printed-scope limits. It never claims hours the magazine does not print.
export function coverageAuthorityErrors(coverage, authority, {dates = [], index = null, minSampledRows = 35, minSampledPerDay = 3, minPagesReread = 7} = {}) {
  const errors = [], g = coverage?.grid_inventory;
  if (!g || typeof g !== 'object') return ['coverage.grid_inventory missing for a Télérama grid-authority week'];
  if (g.source_ref !== authority.source_ref) errors.push('coverage.grid_inventory source_ref mismatch');
  if (g.extraction_scope !== 'all-programmes') errors.push('coverage.grid_inventory requires the all-programmes extraction');
  if (!Number.isInteger(g.grid_pages) || g.grid_pages < 7) errors.push('coverage.grid_inventory grid_pages missing');
  if (!Array.isArray(g.limits) || !g.limits.length || !g.limits.every(value => typeof value === 'string' && value.trim())) errors.push('coverage.grid_inventory.limits must state the printed scope');
  const review = g.transcription_review;
  if (!review || typeof review !== 'object') return [...errors, 'coverage.grid_inventory.transcription_review missing'];
  if (!Number.isFinite(Date.parse(review.reviewed_at || ''))) errors.push('transcription_review.reviewed_at missing');
  if (!String(review.method || '').trim()) errors.push('transcription_review.method missing');
  const rows = Array.isArray(review.sampled_rows) ? review.sampled_rows : [];
  if (rows.length < minSampledRows) errors.push(`transcription_review needs at least ${minSampledRows} sampled rows`);
  for (const date of dates) if (rows.filter(row => row.date === date).length < minSampledPerDay) errors.push(`transcription_review needs at least ${minSampledPerDay} sampled rows on ${date}`);
  const keys = new Set();
  for (const row of rows) {
    if (!Number.isInteger(row.pdf_page) || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')) || !String(row.title || '').trim() || !/^\d{2}:\d{2}$/.test(String(row.start || '')) || !String(row.channel || '').trim()) {errors.push('transcription_review row incomplete'); break;}
    if (!['matches', 'corrected', 'added'].includes(row.decision)) {errors.push('transcription_review row decision must be matches, corrected or added'); break;}
    if (row.decision !== 'matches' && !String(row.note || '').trim()) {errors.push('transcription_review corrected/added row needs a note'); break;}
    const key = inventoryRowKey(row.date, row);
    if (keys.has(key)) {errors.push('transcription_review samples the same row twice'); break;}
    keys.add(key);
    if (index && !index.keys.has(key)) {errors.push(`transcription_review row is not in the inventory: ${row.date} ${row.start} ${row.channel} ${row.title}`); break;}
    if (index && !index.pages.has(row.pdf_page)) {errors.push('transcription_review row cites a page absent from the inventory'); break;}
  }
  const pages = Array.isArray(review.pages_reread) ? review.pages_reread : [];
  if (!pages.every(Number.isInteger) || new Set(pages).size !== pages.length) errors.push('transcription_review.pages_reread must list distinct PDF pages');
  else if (pages.length < minPagesReread) errors.push(`transcription_review needs at least ${minPagesReread} whole pages re-read for omissions`);
  else if (index && pages.some(page => !index.pages.has(page))) errors.push('transcription_review.pages_reread cites a page absent from the inventory');
  if (!Array.isArray(review.discrepancies)) errors.push('transcription_review.discrepancies must be an array (empty when none)');
  return errors;
}
