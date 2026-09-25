import React, { useState, useEffect } from 'react';
import './Issues.css';

const emptyLine = () => ({ kala_id: '', maqdar: '', vahed: '', tavazihat: '' });

export default function Issues() {
  const [issues, setIssues] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [issueLines, setIssueLines] = useState({});
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formData, setFormData] = useState({
    issue_number: '',
    tarikh: new Date().toISOString().split('T')[0],
    tahvil_gir: '',
    mahl_masraf: '',
    tavazihat: '',
    lines: [emptyLine()]
  });

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
      const response = await fetch('/api/items');
      if (!response.ok) throw new Error('خطا در دریافت کالاها');
      const data = await response.json();
      setItems(data);
    } catch (err) {
      console.error('Error fetching items:', err);
    }
  };

  useEffect(() => {
    fetchIssues();
    fetchItems();
  }, []);

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
        if (res.ok) {
          const data = await res.json();
          setIssueLines(prev => ({ ...prev, [id]: data.lines || [] }));
        }
      } catch (err) {
        console.error('Error fetching issue lines:', err);
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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.issue_number || !formData.tarikh) {
      setFormError('شماره حواله و تاریخ الزامی است');
      return;
    }

    const validLines = formData.lines.filter(l => l.kala_id && Number(l.maqdar) > 0);
    if (validLines.length === 0) {
      setFormError('حداقل یک ردیف معتبر وارد کنید');
      return;
    }

    // Client-side stock guard (server re-checks authoritatively)
    const totals = requestedTotals();
    for (const [kodKala, qty] of Object.entries(totals)) {
      const stock = stockOf(kodKala);
      if (stock !== null && qty > stock) {
        const item = items.find(i => i.kod_kala === kodKala);
        setFormError(`موجودی ناکافی برای ${item?.naam_kala || kodKala}: درخواست ${qty}، موجودی ${stock}`);
        return;
      }
    }

    try {
      setSubmitting(true);
      setFormError(null);

      const response = await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue_number: formData.issue_number.trim(),
          tarikh: formData.tarikh,
          tahvil_gir: formData.tahvil_gir.trim(),
          mahl_masraf: formData.mahl_masraf.trim(),
          tavazihat: formData.tavazihat.trim(),
          lines: validLines.map(l => ({
            kala_id: l.kala_id,
            maqdar: Number(l.maqdar),
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
      setFormData({
        issue_number: '',
        tarikh: new Date().toISOString().split('T')[0],
        tahvil_gir: '',
        mahl_masraf: '',
        tavazihat: '',
        lines: [emptyLine()]
      });
      fetchIssues();
      fetchItems(); // refresh stock shown in the page
    } catch (err) {
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
                      {(issueLines[issue.id] || []).length > 0 ? (
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
                        <div className="lines-loading">در حال بارگذاری ردیف‌ها...</div>
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
                    <input
                      type="text"
                      name="issue_number"
                      value={formData.issue_number}
                      onChange={handleHeaderChange}
                      required
                      placeholder="مثال: H-050701-001"
                    />
                  </div>

                  <div className="form-group">
                    <label>تاریخ *</label>
                    <input
                      type="date"
                      name="tarikh"
                      value={formData.tarikh}
                      onChange={handleHeaderChange}
                      required
                    />
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

                    return (
                      <div key={idx} className="line-row">
                        <div className="line-idx">{(idx + 1).toLocaleString('fa-IR')}</div>
                        <div className="line-fields">
                          <select
                            name="kala_id"
                            value={line.kala_id}
                            onChange={(e) => handleLineChange(idx, e)}
                            required
                          >
                            <option value="">انتخاب کالا</option>
                            {items.map(item => (
                              <option key={item.kod_kala} value={item.kod_kala}>
                                {item.kod_kala} - {item.naam_kala} (موجودی: {Number(item.current_stock || 0).toLocaleString('fa-IR')})
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            name="maqdar"
                            value={line.maqdar}
                            onChange={(e) => handleLineChange(idx, e)}
                            placeholder="مقدار"
                            min="0"
                            step="0.01"
                            required
                            className={overLimit ? 'input-error' : ''}
                          />
                          <input
                            type="text"
                            name="vahed"
                            value={line.vahed}
                            onChange={(e) => handleLineChange(idx, e)}
                            placeholder="واحد"
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
                            {overLimit
                              ? `بیش از موجودی (${requested}/${stock})`
                              : `موجودی: ${Number(stock).toLocaleString('fa-IR')} ${line.vahed}`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowForm(false)}>
                  انصراف
                </button>
                <button type="submit" className="btn-submit" disabled={submitting}>
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
