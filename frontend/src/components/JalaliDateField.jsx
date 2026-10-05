import { todayJalali, jalaliMonthLength, jalaliDateParts, formatJalaliDateParts } from '../utils/jalali';
import './JalaliDateField.css';

// Calendar constants, not business data: the Persian month names belong to the
// calendar the whole app uses, and the span of years a report can reach is
// derived from the current year rather than named here.
const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/**
 * An editable Jalali date — year, month and day chosen instead of eight digits
 * and two slashes typed.
 *
 * The value in and out is the canonical `YYYY/MM/DD` string the rest of the app
 * speaks, built by `formatJalaliDateParts` from the app's own calendar helpers.
 * No parallel calendar here: the months come from `jalaliMonthLength`, so a leap
 * Esfand offers its 30th day and no other month offers a day it does not have.
 *
 * Editing one part never disturbs the others, and changing the month or year
 * only ever clamps the day — the form holding this field is never reset by a
 * date edit, and a partial or unparseable value falls back to today rather than
 * throwing.
 *
 * @param {Object} props
 * @param {string} props.value - the current `YYYY/MM/DD`
 * @param {(value: string) => void} props.onChange - emits the new canonical date
 * @param {string} [props.id] - id prefix, so each select can be labelled
 * @param {number} [props.yearsBack] - how many past years the list offers
 * @param {number} [props.yearsAhead] - how many future years the list offers
 */
export default function JalaliDateField({
  value,
  onChange,
  id = 'jalali-date',
  yearsBack = 25,
  yearsAhead = 5,
}) {
  // `todayJalali()` is canonical by construction; if it could not be parsed the
  // calendar helpers themselves would be broken, and there is no date safe to
  // invent in their place.
  const today = jalaliDateParts(todayJalali());
  if (!today) return null;

  // A partial or unrecognised value falls back to today, so the control always
  // shows a real date instead of crashing on one it cannot read.
  const current = jalaliDateParts(value) || today;

  const years = [];
  for (let y = today.jy - yearsBack; y <= today.jy + yearsAhead; y++) {
    years.push(y);
  }

  const daysInMonth = jalaliMonthLength(current.jy, current.jm);
  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(d);
  }

  const change = (part, numeric) => {
    onChange(
      formatJalaliDateParts(
        part === 'year' ? numeric : current.jy,
        part === 'month' ? numeric : current.jm,
        part === 'day' ? numeric : current.jd,
      ),
    );
  };

  return (
    <div className="jalali-date-field" id={id}>
      <span className="jalali-date-part">
        <span className="jalali-date-label" id={`${id}-year-label`}>سال</span>
        <select
          value={current.jy}
          onChange={(e) => change('year', Number(e.target.value))}
          aria-labelledby={`${id}-year-label`}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y.toLocaleString('fa-IR')}</option>
          ))}
        </select>
      </span>
      <span className="jalali-date-part">
        <span className="jalali-date-label" id={`${id}-month-label`}>ماه</span>
        <select
          value={current.jm}
          onChange={(e) => change('month', Number(e.target.value))}
          aria-labelledby={`${id}-month-label`}
        >
          {JALALI_MONTHS.map((name, index) => (
            <option key={index + 1} value={index + 1}>{name}</option>
          ))}
        </select>
      </span>
      <span className="jalali-date-part">
        <span className="jalali-date-label" id={`${id}-day-label`}>روز</span>
        <select
          value={current.jd}
          onChange={(e) => change('day', Number(e.target.value))}
          aria-labelledby={`${id}-day-label`}
        >
          {days.map((d) => (
            <option key={d} value={d}>{d.toLocaleString('fa-IR')}</option>
          ))}
        </select>
      </span>
    </div>
  );
}
