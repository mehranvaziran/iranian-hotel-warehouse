import React, { useState, useEffect, useCallback } from 'react';
import { todayJalali, normalizeJalaliDate, isValidJalaliDate } from '../utils/jalali';
import {
  ISSUE_PREFIX,
  docNumberHead,
  docNumberSequence,
  formatDocNumber,
  isValidDocNumber,
  suggestDocSequence,
  fetchUnitPrecision,
  decimalsForUnit,
  stepForDecimals,
} from '../utils/docNumber';
import {
  isBlankLine,
  lineProblems,
  validateDocumentLines,
} from '../utils/documentLines';
import './Issues.css';

const emptyLine = () => ({ kala_id: '', maqdar: '', vahed: '', tavazihat: '' });

const blankForm = () => ({
  issue_number: '',
  // Jalali, never Gregorian — a Gregorian default would poison date filters.
  tarikh: todayJalali(),
  tahvil_gir: '',
  mahl_masraf: '',
  tavazihat: '',
  lines: [emptyLine()]
});

export default function Issues() {
  const [issues, setIssues] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [issueLines, setIssueLines] = useState({});
  const [lineErrors, setLineErrors] = useState({});
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formData, setFormData] = useState(blankForm);
  // Unit precision is held in the database; the form's `step` comes from these
  // rows so a unit that gains decimals needs no change here.
  const [precision, setPrecision] = useState(new Map());

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/issues');
      if (!response.ok) throw new Error('خطا در دریافت اطلاعات');
      const data = await response.json();
      setIssues(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    try {
      setItemsLoading(true);
      setItemsError(null);
      const response = await fetch('/api/items');
      if (!response.ok) throw new Error('خطا در دریافت کالاها');
      const data = await response.json();
      setItems(data);
    } catch (err) {
      // An empty item list renders the form unusable, so surface the failure
      // instead of silently leaving a dropdown that can never be filled.
      setItemsError(err.message);
    } finally {
      setItemsLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
    fetchItems();
    fetchUnitPrecision().then(setPrecision).catch(() => { /* step falls back to whole numbers */ });
  }, []);

  /**
   * Offer the document number for the date the form is using. The head is
   * derived from the date and the sequence is suggested for it, so the number and
   * the date can never disagree — changing the date rebuilds both. Only the
   * sequence is editable; the head is shown as read-only context.
   */
  const suggestNumber = useCallback(async (tarikh) => {
    if (!isValidJalaliDate(normalizeJalaliDate(tarikh))) return;
    try {
      const seq = await suggestDocSequence('issue', tarikh);
      setFormData((prev) => {
        // The suggestion answers the date it was asked for. A reply that lands
        // after the user moved on to another date would write a head that no
        // longer matches the form, so it is dropped rather than applied.
        if (prev.tarikh !== tarikh) return prev;
        return {
          ...prev,
          issue_number: formatDocNumber(ISSUE_PREFIX, tarikh, seq),
        };
      });
    } catch {
      // Leave the field empty; the backend still validates whatever is typed.
    }
  }, []);

  useEffect(() => {
    suggestNumber(formData.tarikh);
  }, [formData.tarikh, suggestNumber]);

  /** The sequence is the only editable part; the head stays fixed to the date. */
  const handleSequenceChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      issue_number: formatDocNumber(ISSUE_PREFIX, prev.tarikh, e.target.value),
    }));
  };

  const stockOf = (kodKala) => {
    const item = items.find(i => i.kod_kala === kodKala);
    return item ? Number(item.current_stock || 0) : null;
  };

  const toggleExpand = async (id) => {
    if (expanded[id]) {
      setExpanded(prev => ({ ...prev, [id]: false }));
      return;
    }

    if (!issueLines[id]) {
      try {
        const res = await fetch(`/api/issues/${id}`);
        const data = await res.json();
        if (res.ok) {
          setIssueLines(prev => ({ ...prev, [id]: data.lines || [] }));
          setLineErrors(prev => ({ ...prev, [id]: null }));
        } else {
          // Record the failure instead of leaving the cache empty: an empty
          // cache rendered an unending "loading" message with no way to retry.
          setLineErrors(prev => ({ ...prev, [id]: data?.error || 'خطا در دریافت ردیف‌ها' }));
        }
      } catch (err) {
        setLineErrors(prev => ({ ...prev, [id]: err.message }));
      }
    }
    setExpanded(prev => ({ ...prev, [id]: true }));
  };

  const handleHeaderChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleLineChange = (idx, e) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const lines = [...prev.lines];
      lines[idx] = { ...lines[idx], [name]: value };

      if (name === 'kala_id') {
        const selected = items.find(i => i.kod_kala === value);
        if (selected) lines[idx].vahed = selected.vahed;
      }
      return { ...prev, lines };
    });
  };

  const addLine = () => {
    setFormData(prev => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
  };

  const removeLine = (idx) => {
    setFormData(prev => {
      if (prev.lines.length === 1) return prev;
      return { ...prev, lines: prev.lines.filter((_, i) => i !== idx) };
    });
  };

  // Aggregate requested qty per item to validate against available stock
  const requestedTotals = () => {
    const totals = {};
    formData.lines.forEach(l => {
      if (!l.kala_id) return;
      totals[l.kala_id] = (totals[l.kala_id] || 0) + (Number(l.maqdar) || 0);
    });
    return totals;
  };

  /**
   * Every reason the form is not yet submittable, derived from its own state.
   * Each field is checked on its own merits, so one invalid field never wipes
   * what the user already entered elsewhere — the values stay put and only the
   * Submit button stays disabled.
   *
   * No line is dropped here. A line with an item but no quantity, a quantity but
   * no item, or a precision the unit cannot express makes the *whole document*
   * unsubmittable, and the problem is reported on its row — filtering the line
   * out and submitting the rest used to discard what the user had typed without
   * a word.
   */
  const formProblems = () => {
    const problems = [];

    if (!formData.issue_number.trim()) {
      problems.push('شماره حواله الزامی است');
    } else if (!isValidDocNumber(formData.issue_number)) {
      problems.push('شماره حواله باید به صورت H-YYMMDD-شماره ترتیبی باشد');
    }

    if (!formData.tarikh.trim()) {
      problems.push('تاریخ الزامی است');
    } else if (!isValidJalaliDate(normalizeJalaliDate(formData.tarikh))) {
      problems.push('تاریخ باید شمسی و معتبر باشد (مثال: 1405/07/01)');
    }

    // Every line the user entered, each on its own merits. Nothing is filtered
    // out, so nothing is lost: the values stay in the rows and the problems name
    // the rows.
    const lineIssues = validateDocumentLines(formData.lines, items, precision);
    for (const idx of Object.keys(lineIssues).map(Number).sort((a, b) => a - b)) {
      for (const msg of lineIssues[idx]) {
        problems.push(`ردیف ${idx + 1}: ${msg}`);
      }
    }

    if (formData.lines.every(isBlankLine)) {
      problems.push('حداقل یک ردیف با کالا و مقدار مثبت الزامی است');
    }

    // The document as a whole: the sum of every line of the same item must fit
    // the stock. Per-line checks alone let two half-requests add up to more than
    // the warehouse holds.
    const totals = requestedTotals();
    for (const [kodKala, qty] of Object.entries(totals)) {
      const stock = stockOf(kodKala);
      if (stock !== null && qty > stock) {
        const item = items.find(i => i.kod_kala === kodKala);
        problems.push(`موجودی ناکافی برای ${item?.naam_kala || kodKala}: درخواست ${qty}، موجودی ${stock}`);
      }
    }

    return problems;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Derived validity is already what gates the button; this is the last line
    // of defence against a stale render and gives the user a precise reason.
    const problems = formProblems();
    if (problems.length) {
      setFormError(problems[0]);
      return;
    }

    // Only the untouched, empty rows are left out — every line the user entered
    // passed validation, so nothing entered is being dropped here.
    const linesToSend = formData.lines.filter((l) => !isBlankLine(l));

    try {
      setSubmitting(true);
      setFormError(null);

      const response = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue_number: formData.issue_number.trim(),
          tarikh: normalizeJalaliDate(formData.tarikh),
          tahvil_gir: formData.tahvil_gir.trim(),
          mahl_masraf: formData.mahl_masraf.trim(),
          tavazihat: formData.tavazihat.trim(),
          lines: linesToSend.map(l => ({
            kala_id: l.kala_id,
            maqdar: Number(l.maqdar),
            // The unit is the Item Master's; the form sends it for the record and
            // the backend overrides it with the master value regardless.
            vahed: l.vahed || '',
            tavazihat: (l.tavazihat || '').trim()
          }))
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'خطا در ثبت حواله');
      }

      alert('حواله خروج با موفقیت ثبت شد');
      setShowForm(false);
      setFormData(blankForm());
      fetchIssues();
      fetchItems(); // refresh stock shown in the page
    } catch (err) {
      // The typed values are kept: a rejected issue is a fixable form, and
      // clearing it would throw away every quantity the user entered.
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading">در حال بارگذاری...</div>;
  }

  if (error) {
    return <div className="error">خطا: {error}</div>;
  }

  const totals = requestedTotals();
  const problems = showForm ? formProblems() : [];
  const canSubmit = problems.length === 0;

  return (
    <div className="issues-container">
      <div className="issues-header">
        <h1>خروج کالا</h1>
        <div className="header-buttons">
          <button className="btn-refresh" onClick={fetchIssues}>
            🔄 بروزرسانی
          </button>
          <button className="btn-new" onClick={() => { setShowForm(true); setFormError(null); }}>
            + ثبت حواله جدید
          </button>
        </div>
      </div>

      <div className="issues-stats">
        <div className="stat-box">
          <div className="stat-label">کل حواله‌ها</div>
          <div className="stat-value">{issues.length.toLocaleString('fa-IR')}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">کل اقلام خارج شده</div>
          <div className="stat-value">
            {issues.reduce((s, i) => s + Number(i.line_count || 0), 0).toLocaleString('fa-IR')}
          </div>
        </div>
      </div>

      <div className="issues-table-container">
        <table className="issues-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>شماره حواله</th>
              <th>تاریخ</th>
              <th>تحویل‌گیرنده</th>
              <th>محل مصرف</th>
              <th>تعداد اقلام</th>
              <th>مقدار کل</th>
              <th>چاپ</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <React.Fragment key={issue.id}>
                <tr className={expanded[issue.id] ? 'row-expanded' : ''}>
                  <td className="expand-cell">
                    <button
                      className="btn-expand"
                      onClick={() => toggleExpand(issue.id)}
                      aria-label="گسترش ردیف‌ها"
                    >
                      {expanded[issue.id] ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className="issue-num">{issue.issue_number}</td>
                  <td>{issue.tarikh}</td>
                  <td>{issue.tahvil_gir || '-'}</td>
                  <td>{issue.mahl_masraf || '-'}</td>
                  <td>{Number(issue.line_count || 0).toLocaleString('fa-IR')}</td>
                  <td className="maqdar">{Number(issue.total_quantity || 0).toLocaleString('fa-IR')}</td>
                  <td>
                    <button
                      className="btn-print-row"
                      onClick={() => window.open(`/api/print/issue/${issue.id}`, '_blank')}
                    >
                      🖨️
                    </button>
                  </td>
                </tr>
                {expanded[issue.id] && (
                  <tr className="lines-row">
                    <td colSpan={8}>
                      {lineErrors[issue.id] ? (
                        <div className="lines-error">
                          <span>⚠️ {lineErrors[issue.id]}</span>
                          <button
                            type="button"
                            className="btn-retry-lines"
                            onClick={() => {
                              setIssueLines(prev => ({ ...prev, [issue.id]: undefined }));
                              setLineErrors(prev => ({ ...prev, [issue.id]: null }));
                              toggleExpand(issue.id);
                            }}
                          >
                            تلاش مجدد
                          </button>
                        </div>
                      ) : (issueLines[issue.id] || []).length > 0 ? (
                        <table className="lines-table">
                          <thead>
                            <tr>
                              <th style={{ width: 40 }}>ردیف</th>
                              <th>کد کالا</th>
                              <th>نام کالا</th>
                              <th>مقدار</th>
                              <th>واحد</th>
                              <th>توضیحات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {issueLines[issue.id].map((line, idx) => (
                              <tr key={line.id || idx}>
                                <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                                <td className="kod-kala">{line.kala_id}</td>
                                <td>{line.naam_kala || '-'}</td>
                                <td className="maqdar">{Number(line.maqdar).toLocaleString('fa-IR')}</td>
                                <td>{line.vahed || '-'}</td>
                                <td>{line.tavazihat || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="lines-empty">ردیفی برای این حواله ثبت نشده است</div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {issues.length === 0 && (
        <div className="empty-state">
          هیچ حواله‌ای ثبت نشده است
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>ثبت حواله خروج جدید</h2>
              <button className="btn-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}

                <div className="form-row">
                  <div className="form-group">
                    <label>شماره حواله *</label>
                    <div className="doc-number-field" dir="ltr">
                      {/* The prefix and the date head are fixed by the document's
                          date, so they are context, not inputs: only the sequence
                          is the user's to choose or change. */}
                      <span
                        className="doc-number-head"
                        title="پیشوند و تاریخ داخل شماره از تاریخ سند ساخته می‌شوند و قابل تغییر نیستند"
                      >
                        {docNumberHead(ISSUE_PREFIX, formData.tarikh)}
                      </span>
                      <input
                        type="text"
                        name="issue_sequence"
                        value={docNumberSequence(formData.issue_number)}
                        onChange={handleSequenceChange}
                        required
                        placeholder="شماره ترتیبی"
                        inputMode="numeric"
                        dir="ltr"
                        className="doc-number-seq"
                      />
                    </div>
                    {formData.issue_number && !isValidDocNumber(formData.issue_number) && (
                      <div className="field-hint field-hint-error">
                        شماره باید به صورت H-YYMMDD-شماره ترتیبی باشد
                      </div>
                    )}
                    {isValidDocNumber(formData.issue_number) && (
                      <div className="field-hint">
                        پیشنهاد سامانه برای تاریخ {formData.tarikh}
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label>تاریخ * (شمسی — مثال: 1405/07/01)</label>
                    <input
                      type="text"
                      name="tarikh"
                      value={formData.tarikh}
                      onChange={handleHeaderChange}
                      required
                      placeholder="YYYY/MM/DD"
                      inputMode="numeric"
                      dir="ltr"
                      className={
                        formData.tarikh && !isValidJalaliDate(normalizeJalaliDate(formData.tarikh))
                          ? 'input-error'
                          : ''
                      }
                    />
                    {formData.tarikh && !isValidJalaliDate(normalizeJalaliDate(formData.tarikh)) && (
                      <div className="field-hint field-hint-error">
                        تاریخ شمسی معتبر نیست — ماه‌های ۱ تا ۶ سی‌ویک روزه هستند
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>تحویل‌گیرنده</label>
                    <input
                      type="text"
                      name="tahvil_gir"
                      value={formData.tahvil_gir}
                      onChange={handleHeaderChange}
                      placeholder="نام تحویل‌گیرنده"
                    />
                  </div>

                  <div className="form-group">
                    <label>محل مصرف</label>
                    <input
                      type="text"
                      name="mahl_masraf"
                      value={formData.mahl_masraf}
                      onChange={handleHeaderChange}
                      placeholder="محل مصرف"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>توضیحات</label>
                  <input
                    type="text"
                    name="tavazihat"
                    value={formData.tavazihat}
                    onChange={handleHeaderChange}
                    placeholder="توضیحات سند"
                  />
                </div>

                <div className="lines-section">
                  <div className="lines-section-header">
                    <h3>ردیف‌های حواله</h3>
                    <button type="button" className="btn-add-line" onClick={addLine}>
                      + افزودن ردیف
                    </button>
                  </div>

                  {formData.lines.map((line, idx) => {
                    const stock = stockOf(line.kala_id);
                    const requested = totals[line.kala_id] || 0;
                    const overLimit = stock !== null && requested > stock;
                    const item = items.find((i) => i.kod_kala === line.kala_id);
                    const decimals = decimalsForUnit(precision, line.vahed);
                    // What the warehouse would hold if this document were issued
                    // as it stands — cumulative across every line of this item,
                    // which is the number the user is actually deciding about.
                    const remaining = stock === null ? null : stock - requested;
                    // Every problem this row has on its own merits — an
                    // incomplete row is reported on the row, never discarded.
                    const rowProblems = isBlankLine(line)
                      ? []
                      : lineProblems(line, items, precision);
                    const qtyBad = rowProblems.length > 0;

                    return (
                      <div key={idx} className="line-row">
                        <div className="line-idx">{(idx + 1).toLocaleString('fa-IR')}</div>
                        <div className="line-fields">
                          {itemsError ? (
                            // A failed item fetch leaves an empty dropdown that can
                            // never be filled, so say so instead of rendering a
                            // silently unusable control.
                            <div className="line-fields-error">
                              <span>⚠️ {itemsError}</span>
                              <button
                                type="button"
                                className="btn-retry-lines"
                                onClick={fetchItems}
                              >
                                تلاش مجدد
                              </button>
                            </div>
                          ) : (
                            <select
                              name="kala_id"
                              value={line.kala_id}
                              onChange={(e) => handleLineChange(idx, e)}
                              required
                              disabled={itemsLoading}
                            >
                              <option value="">
                                {itemsLoading ? 'در حال بارگذاری کالاها...' : 'انتخاب کالا'}
                              </option>
                              {items.map(item => (
                                <option key={item.kod_kala} value={item.kod_kala}>
                                  {item.kod_kala} - {item.naam_kala} (موجودی: {Number(item.current_stock || 0).toLocaleString('fa-IR')})
                                </option>
                              ))}
                            </select>
                          )}
                          <input
                            type="number"
                            name="maqdar"
                            value={line.maqdar}
                            onChange={(e) => handleLineChange(idx, e)}
                            placeholder="مقدار"
                            min="0"
                            step={stepForDecimals(decimals)}
                            required
                            className={overLimit || qtyBad ? 'input-error' : ''}
                            // A rejected submit must not blank a quantity the user
                            // typed; the value is controlled state and is kept.
                          />
                          <input
                            type="text"
                            name="vahed"
                            value={line.vahed}
                            readOnly
                            placeholder="واحد"
                            title="واحد از تعریف کالا گرفته می‌شود و قابل تغییر نیست"
                            className="input-readonly"
                          />
                          <input
                            type="text"
                            name="tavazihat"
                            value={line.tavazihat}
                            onChange={(e) => handleLineChange(idx, e)}
                            placeholder="توضیحات ردیف"
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-remove-line"
                          onClick={() => removeLine(idx)}
                          disabled={formData.lines.length === 1}
                          aria-label="حذف ردیف"
                        >
                          ×
                        </button>
                        {line.kala_id && (
                          <div className={`line-stock ${overLimit ? 'stock-over' : ''}`}>
                            {overLimit ? (
                              <>
                                بیش از موجودی ({requested}/{stock})
                                {/* The entered quantity is repeated back so the
                                  failure does not hide what was asked for. */}
                                <span className="stock-detail">
                                  موجودی پس از این حواله: {Number(remaining).toLocaleString('fa-IR')} {line.vahed}
                                </span>
                              </>
                            ) : (
                              <>
                                موجودی: {Number(stock).toLocaleString('fa-IR')} {line.vahed}
                                <span className="stock-detail">
                                  موجودی پس از این حواله: {Number(remaining).toLocaleString('fa-IR')} {line.vahed}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                        {qtyBad && (
                          <div className="line-stock stock-over">
                            {rowProblems.map((p, i) => (
                              <div key={i}>• {p}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="modal-footer">
                {problems.length > 0 && (
                  <div className="form-footer-problems">
                    {problems.map((p, i) => (
                      <div key={i}>• {p}</div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    // Cancel closes the form and keeps what was typed. Wiping the
                    // fields here would lose a half-enterered document over a
                    // distraction; the values are still here when the form reopens.
                    setShowForm(false);
                    setFormError(null);
                  }}
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={submitting || !canSubmit}
                  title={canSubmit ? '' : problems[0]}
                >
                  {submitting ? 'در حال ثبت...' : 'ثبت حواله'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
