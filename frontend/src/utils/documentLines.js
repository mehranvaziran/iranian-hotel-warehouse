/**
 * Document-line validation, shared by the receipt and issue forms.
 *
 * The rule these forms used to get wrong was *filtering before validating*:
 *
 *     lines.filter(l => l.kala_id && Number(l.maqdar) > 0)
 *
 * A document with one filled line and one half-entered line silently submitted
 * just the filled one, and the user never learned that the other line was gone.
 * A line is either valid or the whole document is invalid — nothing in between
 * is dropped, and every problem is reported on the row it belongs to.
 *
 * A line the user has not touched at all (no item, no quantity, no note) carries
 * nothing to lose, so it is the one thing that does not block submission. It is
 * not "filtered out for being invalid" — it is empty, and the empty ones are
 * skipped when the payload is built.
 */

import { decimalsForUnit, quantityFitsPrecision } from './docNumber';

/**
 * True when a line holds nothing the user entered.
 * @param {{kala_id: string, maqdar: string, tavazihat?: string}} line
 */
export function isBlankLine(line) {
  return !line.kala_id &&
    String(line.maqdar ?? '').trim() === '' &&
    !String(line.tavazihat ?? '').trim();
}

/**
 * Every reason one line is not submittable, in Persian, or `[]` when the line is
 * fine. Each reason is checked on its own merits, so a bad quantity never hides
 * a good item or vice versa — the values the user entered stay on screen and the
 * problems name the row they are on.
 *
 * @param {object} line - one form row
 * @param {Array} items - the Item Master rows the dropdown offers
 * @param {Map<string, number>} precision - unit name -> allowed decimal places
 * @returns {string[]}
 */
export function lineProblems(line, items, precision) {
  const problems = [];

  const item = items.find((i) => i.kod_kala === line.kala_id);
  const qtyRaw = String(line.maqdar ?? '').trim();
  const qty = Number(qtyRaw);

  if (!line.kala_id) {
    problems.push('انتخاب کالا الزامی است');
  }

  if (qtyRaw === '') {
    problems.push('مقدار الزامی است');
  } else if (!Number.isFinite(qty) || qty <= 0) {
    problems.push('مقدار باید عددی بزرگ‌تر از صفر باشد');
  }

  // A code that is not in the catalog cannot be resolved to a unit at all. This
  // is what keeps a retired item out of a new document: it is absent from the
  // active catalog the dropdown is built from.
  if (line.kala_id && !item) {
    problems.push('کالا در فهرست کالاهای فعال نیست');
  }

  // The unit's precision decides what a quantity for this item may look like. A
  // quantity the unit cannot express is refused, not rounded — recording
  // something the user did not type would be the same lie as dropping the line.
  if (item && Number.isFinite(qty) && qty > 0) {
    const decimals = decimalsForUnit(precision, item.vahed);
    if (!quantityFitsPrecision(qty, decimals)) {
      problems.push(
        `مقدار برای واحد «${item.vahed || 'بدون واحد'}» باید ${decimals} رقم اعشار داشته باشد`
      );
    }
  }

  return problems;
}

/**
 * Problems for every line the user has entered, keyed by row index. Blank rows
 * are absent from the result; a document whose every row is blank is reported by
 * the caller, because that is a statement about the document, not about a row.
 *
 * @param {Array} lines
 * @param {Array} items
 * @param {Map<string, number>} precision
 * @returns {Record<number, string[]>}
 */
export function validateDocumentLines(lines, items, precision) {
  const byIndex = {};
  lines.forEach((line, idx) => {
    if (isBlankLine(line)) return;
    const problems = lineProblems(line, items, precision);
    if (problems.length) byIndex[idx] = problems;
  });
  return byIndex;
}

/**
 * True when every line the user entered is submittable. The payload is built from
 * the non-blank lines only, so this being true means nothing entered is dropped.
 */
export function everyEnteredLineIsValid(lines, items, precision) {
  return lines.every((line) => isBlankLine(line) || lineProblems(line, items, precision).length === 0);
}
