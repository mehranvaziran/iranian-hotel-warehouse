import React, { useState, useEffect } from 'react';
import './Receipts.css';

const emptyLine = () => ({ kala_id: '', maqdar: '', vahed: '', tavazihat: '' });

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [receiptLines, setReceiptLines] = useState({});
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formData, setFormData] = useState({
    receipt_number: '',
    tarikh: new Date().toISOString().split('T')[0],
    tavazihat: '',
    lines: [emptyLine()]
  });

  const fetchReceipts = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/receipts');
      if (!response.ok) throw new Error('خطا در دریافت اطلاعات');
      const data = await response.json();
      setReceipts(data);
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
    fetchReceipts();
    fetchItems();
  }, []);

  const toggleExpand = async (id) => {
    if (expanded[id]) {
      setExpanded(prev => ({ ...prev, [id]: false }));
      return;
    }

    // Lazy-load lines once
    if (!receiptLines[id]) {
      try {
        const res = await fetch(`/api/receipts/${id}`);
        if (res.ok) {
          const data = await res.json();
          setReceiptLines(prev => ({ ...prev, [id]: data.lines || [] }));
        }
      } catch (err) {
        console.error('Error fetching receipt lines:', err);
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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.receipt_number || !formData.tarikh) {
      setFormError('شماره رسید و تاریخ الزامی است');
      return;
    }

    const validLines = formData.lines.filter(l => l.kala_id && Number(l.maqdar) > 0);
    if (validLines.length === 0) {
      setFormError('حداقل یک ردیف معتبر وارد کنید');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);

      const response = await fetch('/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt_number: formData.receipt_number.trim(),
          tarikh: formData.tarikh,
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
        throw new Error(errorData.error || 'خطا در ثبت رسید');
      }

      alert('رسید با موفقیت ثبت شد');
      setShowForm(false);
      setFormData({
        receipt_number: '',
        tarikh: new Date().toISOString().split('T')[0],
        tavazihat: '',
        lines: [emptyLine()]
      });
      fetchReceipts();
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

  return (
    <div className="receipts-container">
      <div className="receipts-header">
        <h1>ورود کالا</h1>
        <div className="header-buttons">
          <button className="btn-refresh" onClick={fetchReceipts}>
            🔄 بروزرسانی
          </button>
          <button className="btn-new" onClick={() => { setShowForm(true); setFormError(null); }}>
            + ثبت رسید جدید
          </button>
        </div>
      </div>

      <div className="receipts-stats">
        <div className="stat-box">
          <div className="stat-label">کل رسیدها</div>
          <div className="stat-value">{receipts.length.toLocaleString('fa-IR')}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">کل اقلام وارد شده</div>
          <div className="stat-value">
            {receipts.reduce((s, r) => s + Number(r.line_count || 0), 0).toLocaleString('fa-IR')}
          </div>
        </div>
      </div>

      <div className="receipts-table-container">
        <table className="receipts-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}></th>
              <th>شماره رسید</th>
              <th>تاریخ</th>
              <th>تعداد اقلام</th>
              <th>مقدار کل</th>
              <th>توضیحات</th>
              <th>چاپ</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <React.Fragment key={receipt.id}>
                <tr className={expanded[receipt.id] ? 'row-expanded' : ''}>
                  <td className="expand-cell">
                    <button
                      className="btn-expand"
                      onClick={() => toggleExpand(receipt.id)}
                      aria-label="گسترش ردیف‌ها"
                    >
                      {expanded[receipt.id] ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className="receipt-num">{receipt.receipt_number}</td>
                  <td>{receipt.tarikh}</td>
                  <td>{Number(receipt.line_count || 0).toLocaleString('fa-IR')}</td>
                  <td className="maqdar">{Number(receipt.total_quantity || 0).toLocaleString('fa-IR')}</td>
                  <td className="tavazihat-cell">{receipt.tavazihat || '-'}</td>
                  <td>
                    <button
                      className="btn-print-row"
                      onClick={() => window.open(`/api/print/receipt/${receipt.id}`, '_blank')}
                    >
                      🖨️
                    </button>
                  </td>
                </tr>
                {expanded[receipt.id] && (
                  <tr className="lines-row">
                    <td colSpan={7}>
                      {(receiptLines[receipt.id] || []).length > 0 ? (
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
                            {receiptLines[receipt.id].map((line, idx) => (
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

      {receipts.length === 0 && (
        <div className="empty-state">
          هیچ رسیدی ثبت نشده است
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>ثبت رسید ورود جدید</h2>
              <button className="btn-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}

                <div className="form-row">
                  <div className="form-group">
                    <label>شماره رسید *</label>
                    <input
                      type="text"
                      name="receipt_number"
                      value={formData.receipt_number}
                      onChange={handleHeaderChange}
                      required
                      placeholder="مثال: R-050701-001"
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
                    <h3>ردیف‌های رسید</h3>
                    <button type="button" className="btn-add-line" onClick={addLine}>
                      + افزودن ردیف
                    </button>
                  </div>

                  {formData.lines.map((line, idx) => (
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
                              {item.kod_kala} - {item.naam_kala}
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
                    </div>
                  ))}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={() => setShowForm(false)}>
                  انصراف
                </button>
                <button type="submit" className="btn-submit" disabled={submitting}>
                  {submitting ? 'در حال ثبت...' : 'ثبت رسید'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
