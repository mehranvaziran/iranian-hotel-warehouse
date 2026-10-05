/**
 * Document number convention.
 *
 * Every receipt and issue in this system is numbered
 *
 *     {R|H}-{Jalali YYMMDD}-{seq}
 *
 * e.g. `R-050617-173` for a receipt on 1405/06/17 and `H-050617-3` for the third
 * issue on the same day. This is the format the existing documents use — the
 * six-digit middle field is a *Jalali* YYMMDD, not a Gregorian one, which
 * matters because a Jalali and a Gregorian date with the same digits fall in
 * different decades and would never collide. A document number is therefore
 * self-describing: it says which calendar the document's date is in.
 *
 * This module is the only place the format is spelled out. The front-end uses it
 * to pre-fill a new number; the API uses it to reject a malformed one.
 *
 * Note on existing data: the live database also holds deliberately invalid
 * numbers (an unformatted string, and one whose embedded date is Gregorian).
 * Those are QA evidence and are never rewritten by this module — the validator
 * merely refuses to *create* another such number. Historical documents are read
 * and printed exactly as they were recorded.
 */

/** The prefixes, singular and as a set used for validation. */
export const RECEIPT_PREFIX = 'R';
export const ISSUE_PREFIX = 'H';
const PREFIXES = new Set([RECEIPT_PREFIX, ISSUE_PREFIX]);

// One-or-more digits for the sequence. The observed sequence numbers are plain
// integers (1, 2, 3 … 173); no separator inside the sequence part is allowed.
const DOC_NUMBER_RE = /^([RH])-(\d{6})-(\d+)$/;

/** The field name used in messages, per document kind. */
function fieldLabel(prefix) {
  return prefix === RECEIPT_PREFIX ? 'رسید' : 'حواله';
}

/**
 * The six-digit Jalali YYMMDD a canonical `YYYY/MM/DD` date carries inside a
 * document number: `1405/07/01` -> `050701`. Returns `null` when the date is not
 * in the canonical shape, so callers can fall back rather than emit a head built
 * from the wrong number of digits.
 *
 * @param {string} jalaliDate
 * @returns {string|null}
 */
export function jalaliHead(jalaliDate) {
  // `1405/07/01` splits into century-pair, two-digit year, month, day. The head
  // carries the *year's* last two digits: 1405/07/01 -> 050701.
  const m = /^(\d{2})(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(jalaliDate ?? '').trim()) || [];
  if (m.length < 5) return null;
  return `${m[2]}${m[3]}${m[4]}`;
}

/**
 * Build the document-number pattern for one kind, given a Jalali date.
 *
 * @param {string} prefix - 'R' or 'H'
 * @param {string} jalaliDate - canonical `YYYY/MM/DD`
 * @returns {string} e.g. 'R-050617-'
 */
function numberPrefixFor(prefix, jalaliDate) {
  const head = jalaliHead(jalaliDate);
  return head === null ? `${prefix}-` : `${prefix}-${head}-`;
}

/**
 * The six digits embedded in a document number, or `null` when the number does
 * not follow the convention. This is what the date-agreement rule compares
 * against the document's own `tarikh`.
 *
 * @param {string} value
 * @returns {string|null}
 */
export function docNumberEmbeddedDate(value) {
  const m = DOC_NUMBER_RE.exec(String(value ?? '').trim());
  return m ? m[2] : null;
}

/**
 * True when `value` is a well-formed document number whose embedded date is a
 * real Jalali date. Accepts both `R-050617-173` and the bare sequence part
 * (`173`) the front-end offers as the editable tail of a suggested number.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isValidDocNumber(value) {
  return DOC_NUMBER_RE.test(String(value ?? '').trim());
}

/**
 * Throw a 400-shaped rejection when a new document number does not follow the
 * convention. The message names the expected shape so the user can correct it
 * without reading a log.
 *
 * @param {string} value - the number the client sent
 * @param {string} prefix - 'R' or 'H', to tailor the message
 */
export function assertValidDocNumber(value, prefix) {
  const label = fieldLabel(prefix);
  const v = String(value ?? '').trim();
  if (!v) {
    const err = new Error(`شماره ${label} الزامی است`);
    err.statusCode = 400;
    throw err;
  }
  if (!isValidDocNumber(v)) {
    const err = new Error(
      `شماره ${label} باید به صورت «${prefix}-YYMMDD-شماره ترتیبی» باشد ` +
        `(مثال: ${prefix}-050617-1). تاریخ داخل شماره باید شمسی باشد.`
    );
    err.statusCode = 400;
    throw err;
  }
  return v;
}

/**
 * Reject when the Jalali date embedded in a document number is not the document's
 * own `tarikh`.
 *
 * A document number is self-describing — its middle field *is* the document's
 * Jalali day — so a number whose embedded date disagrees with the header date is
 * a wrong number, not a differently-formatted one. The front-end makes the head
 * non-editable so this cannot be typed, but the API cannot trust the client: this
 * is the rule that keeps the two fields from ever drifting apart server-side.
 *
 * Both values are expected to have passed their own shape checks already (a
 * canonical `tarikh` from `assertJalaliDate`, a convention-shaped number from
 * `assertValidDocNumber`); when either is not in that shape the comparison is
 * skipped rather than duplicated here.
 *
 * @param {string} value - the document number
 * @param {string} prefix - 'R' or 'H', to tailor the message
 * @param {string} tarikh - canonical `YYYY/MM/DD`
 */
export function assertDocNumberMatchesTarikh(value, prefix, tarikh) {
  const embedded = docNumberEmbeddedDate(value);
  const head = jalaliHead(tarikh);
  if (embedded === null || head === null) return;

  if (embedded !== head) {
    const err = new Error(
      `تاریخ داخل شماره ${fieldLabel(prefix)} (${embedded}) باید با تاریخ سند ` +
        `(${tarikh}) یکی باشد`
    );
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Suggest the next document number for a given kind and Jalali date.
 *
 * The sequence is *per kind and continuous across the whole table*: the next
 * number is one past the highest sequence that kind has ever used, no matter
 * which date that number carried. So after `R-050617-173` a receipt dated
 * `1405/07/10` is offered `R-050710-174`, not `R-050710-1` — the date only
 * chooses the YYMMDD in the head; it never restarts the count. The two kinds
 * count independently, so receipts and issues can both be on sequence 20.
 *
 * A number that does not follow the convention does not participate: the live
 * data holds deliberately free-form QA numbers, and they are skipped rather than
 * allowed to poison or break the count.
 *
 * The result is the *editable tail* (the sequence), because the front-end shows
 * the date-bearing head as read-only context. Callers that want the whole
 * number use `formatDocNumber`.
 *
 * @param {object} db - the sqlite connection
 * @param {string} prefix - 'R' or 'H'
 * @param {string} jalaliDate - canonical `YYYY/MM/DD` — sets the head only
 * @returns {Promise<string>} the suggested sequence number, e.g. '174'
 */
export async function suggestDocNumber(db, prefix, jalaliDate) {
  const column = prefix === RECEIPT_PREFIX ? 'receipt_number' : 'issue_number';
  const table = prefix === RECEIPT_PREFIX ? 'receipts' : 'issues';

  const rows = await db.all(`SELECT ${column} AS num FROM ${table}`);

  let maxSeq = 0;
  for (const row of rows) {
    const m = DOC_NUMBER_RE.exec(String(row.num ?? '').trim());
    // A number of the other kind, or a historical free-form number, carries no
    // sequence to continue from.
    if (!m || m[1] !== prefix) continue;
    const seq = Number(m[3]);
    if (Number.isInteger(seq) && seq > maxSeq) maxSeq = seq;
  }

  return String(maxSeq + 1);
}

/**
 * Assemble the full document number from a kind, a Jalali date and a sequence.
 *
 * @param {string} prefix - 'R' or 'H'
 * @param {string} jalaliDate - canonical `YYYY/MM/DD`
 * @param {string|number} seq - the sequence tail
 * @returns {string} e.g. 'H-050617-4'
 */
export function formatDocNumber(prefix, jalaliDate, seq) {
  return `${numberPrefixFor(prefix, jalaliDate)}${seq}`;
}
