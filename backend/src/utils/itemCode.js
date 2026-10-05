/**
 * Item-code numbering.
 *
 * An item code is a group prefix followed by a numeric sequence inside that
 * group — `K001`, `T005`, `S002`. The prefix is letters and the digits are a
 * counter, which means the codes do not sort the way they read: `K9` is textually
 * *higher* than `K010` even though 9 < 10. Ordering them as text is how a
 * "next code" suggestion once offered a code that already existed.
 *
 * This is the only place the shape is parsed. The API's suggestion endpoint and
 * the catalog ordering both go through it, so the numeric rule lives in one spot.
 */

const CODE_RE = /^([^\d]*)(\d+)(.*)$/;

/**
 * Split an item code into its prefix, numeric suffix and any trailing text.
 *
 * @param {string} code - e.g. 'K019', 'K9', 'K019-ب', 'T005'
 * @returns {{prefix: string, digits: string, number: number, rest: string}|null}
 *   `null` when the code has no numeric part at all.
 */
export function parseItemCode(code) {
  const m = CODE_RE.exec(String(code ?? '').trim());
  if (!m) return null;
  return { prefix: m[1], digits: m[2], number: Number(m[2]), rest: m[3] };
}

/**
 * The letters a code is grouped under — everything before the first digit.
 * `K019` carries `K`, `KA1` carries `KA`. A code with no digits at all is its
 * own prefix. The suggestion endpoint reads this off whatever the user typed so
 * the shape of a code is parsed in exactly one place.
 *
 * @param {string} code - what the user has typed so far
 * @returns {string} the prefix, trimmed and upper-cased as the catalog keeps it
 */
export function itemCodePrefix(code) {
  const m = /^([^\d]+)/.exec(String(code ?? '').trim());
  return (m ? m[1] : '').trim().toUpperCase();
}

/**
 * Every code that begins with this prefix. LIKE with an ESCAPE would matter if a
 * prefix could contain `_` or `%`; a group prefix cannot, so a plain literal
 * pattern is safe and readable.
 */
async function codesBeginningWith(db, prefix) {
  const p = String(prefix ?? '').trim().toUpperCase();
  return db.all(
    `SELECT kod_kala FROM kala WHERE kod_kala LIKE ? ESCAPE '\\'`,
    [`${p.replace(/\\/g, '\\\\')}%`]
  );
}

/**
 * The highest-numbered code already registered for a prefix.
 *
 * Only codes whose own prefix *is* the asked-for one count — 'KA1' begins with
 * 'K' but belongs to the 'KA' group, not to 'K'. Ordering is numeric: `K9` is
 * textually above `K010` while numbering below it.
 *
 * @param {object} db - the sqlite connection
 * @param {string} prefix - the group prefix, e.g. 'K'
 * @returns {Promise<string|null>} e.g. 'K018', or `null` when the prefix is unused
 */
export async function lastItemCode(db, prefix) {
  const p = String(prefix ?? '').trim().toUpperCase();
  let maxNumber = -1;
  let maxCode = null;
  for (const row of await codesBeginningWith(db, p)) {
    const parsed = parseItemCode(row.kod_kala);
    if (!parsed || parsed.prefix !== p) continue;
    if (parsed.number > maxNumber) {
      maxNumber = parsed.number;
      maxCode = row.kod_kala;
    }
  }
  return maxCode;
}

/**
 * The widest numeric suffix the catalog uses. A group that has no codes yet has
 * no width of its own, so it inherits the padding the catalog already uses — a
 * `K###` catalog starts a new group at `E001` rather than a shapeless `E1`. The
 * width is read off the data, never assumed.
 */
async function catalogDigitWidth(db) {
  let width = 0;
  for (const row of await db.all('SELECT kod_kala FROM kala')) {
    const parsed = parseItemCode(row.kod_kala);
    if (parsed && parsed.digits.length > width) width = parsed.digits.length;
  }
  return Math.max(width, 1);
}

/**
 * Suggest the next free code for a prefix, from the highest *numeric* suffix
 * already used by that prefix.
 *
 * The suggestion is guidance only — nothing forces the user to take it, and a
 * code it "suggests" that already exists is a bug in this function, not in the
 * user's choice. Width is not assumed: it is the width the catalog itself
 * already uses for that sequence (`K9` is followed by `K10`, `K010` by `K011`),
 * because the counter is a number and not a fixed-width string.
 *
 * @param {object} db - the sqlite connection
 * @param {string} prefix - the group prefix, e.g. 'K'
 * @returns {Promise<string>} e.g. 'K011'
 */
export async function suggestNextItemCode(db, prefix) {
  const p = String(prefix ?? '').trim().toUpperCase();
  const last = await lastItemCode(db, p);

  if (last) {
    // The width comes from the code that carries the maximum, so a catalog
    // padded to three digits keeps its padding and a single-digit catalog does
    // not gain any.
    const parsed = parseItemCode(last);
    return `${p}${String(parsed.number + 1).padStart(parsed.digits.length, '0')}`;
  }

  // No code for this prefix yet, so its sequence starts at 1 — at the padding
  // the rest of the catalog uses.
  const width = await catalogDigitWidth(db);
  return `${p}${'1'.padStart(width, '0')}`;
}
