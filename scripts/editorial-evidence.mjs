// Compact evidence records of data/research/YYYY-Sxx.json verification_records.
// One record states one verified fact: where (url), when (checked_at), which
// field, what result. It replaces prose notes; it never certifies a card,
// a requirement or a publication, and no publication gate reads it.

export const EVIDENCE_RESULTS = ['verified', 'corrected', 'contradicted', 'unavailable', 'not_found'];
export const NOTE_MAX = 280;
export const VALUE_MAX = 300;
// Status names already understood by the planning tools.
const STATUS = {verified: 'verified', corrected: 'verified_corrected', contradicted: 'contradicted',
  unavailable: 'unavailable', not_found: 'not_found'};
const identityField = /^(?:title|original_title|director|directors|creator|year|country|countries|genre)(?:\.|$)/;
const text = value => typeof value === 'string' && value.trim().length > 0;
const array = value => Array.isArray(value) ? value : [];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const instant = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
// A Web page, or a page of the provided PDF identified by its digest.
export const evidenceUrl = value => typeof value === 'string' &&
  (/^https?:\/\/\S+$/.test(value) || /^sha256:[a-f0-9]{64}#page=[1-9]\d*$/.test(value));

// The compact shape is recognised by its singular url and result fields.
export const isCompactRecord = record => object(record) && typeof record.result === 'string' && typeof record.url === 'string';

export function compactRecordErrors(record) {
  if (!object(record)) return ['record must be an object'];
  const errors = [];
  if (!evidenceUrl(record.url)) errors.push('url must be an http(s) page or sha256:<pdf digest>#page=N');
  if (!instant(record.checked_at)) errors.push('checked_at must be the real ISO time of the check');
  if (!text(record.field)) errors.push('field must name the verified fact (e.g. broadcast.start, director, ratings.imdb)');
  if (!EVIDENCE_RESULTS.includes(record.result)) errors.push('result must be one of ' + EVIDENCE_RESULTS.join(', '));
  const scope = record.applies_to;
  if (!text(record.work_id) && !text(record.title) && !(object(scope) && (text(scope.work_id) || text(scope.title) ||
    (text(scope.date) && text(scope.channel))))) errors.push('record needs work_id, title or an applies_to {date, channel} scope');
  if (record.value !== undefined && record.value !== null && !['string', 'number', 'boolean'].includes(typeof record.value)) {
    errors.push('value must be a short scalar');
  } else if (String(record.value ?? '').length > VALUE_MAX) errors.push(`value exceeds ${VALUE_MAX} characters`);
  if (['corrected', 'contradicted'].includes(record.result) && (record.value === undefined || record.value === null || record.value === '')) {
    errors.push('a corrected or contradicted record states the observed value');
  }
  if (record.note !== undefined && !(typeof record.note === 'string' && record.note.length <= NOTE_MAX)) {
    errors.push(`note must be a string of at most ${NOTE_MAX} characters`);
  }
  if (record.stability !== undefined && !['stable', 'cycle_specific'].includes(record.stability)) {
    errors.push('stability must be stable or cycle_specific');
  }
  return errors;
}

// Informative: malformed compact records, by index. Legacy records are left alone.
export function compactEvidenceGaps(progress) {
  return array(progress?.verification_records).flatMap((record, index) => isCompactRecord(record)
    ? compactRecordErrors(record).map(error => `verification_records[${index}]: ${error}`) : []);
}

/** View read by the planning tools. Compact records gain the legacy fields
 * (fields, source_urls, status, stability); legacy records keep theirs, with
 * `urls` accepted as source_urls. The stored record is never changed.
 */
export function normalizeEvidenceRecord(record) {
  if (!object(record)) return record;
  if (isCompactRecord(record)) {
    return {...record, fields: [record.field], source_urls: [record.url],
      status: STATUS[record.result] || record.result,
      stability: record.stability || (identityField.test(record.field) ? 'stable' : 'cycle_specific'),
      evidence_note: record.note ?? null};
  }
  if (record.source_urls === undefined && Array.isArray(record.urls)) return {...record, source_urls: record.urls};
  return record;
}
