import React, { useState, useEffect } from 'react';
import './Issues.css';

export default function Issues() {
  const [issues, setIssues] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    issue_num: '',
    tarikh: new Date().toISOString().split('T')[0],
    kala_id: '',
    maqdar: '',
    vahed: '',
    tahvil_gir: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [selectedItemStock, setSelectedItemStock] = useState(null);

  useEffect(() => {
    fetchIssues();
    fetchItems();
  }, []);

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000/api/issues');
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
      const response = await fetch('http://localhost:3000/api/items');
      if (!response.ok) throw new Error('خطا در دریافت کالاها');
      const data = await response.json();
      setItems(data);
    } catch (err) {
      console.error('Error fetching items:', err);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    if (name === 'kala_id') {
      const selectedItem = items.find(item => item.kod_kala === value);
      if (selectedItem) {
        setFormData(prev => ({ ...prev, vahed: selectedItem.vahed }));
        setSelectedItemStock(selectedItem.mojoodi_fael);
      } else {
        setSelectedItemStock(null);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.issue_num || !formData.kala_id || !formData.maqdar) {
      alert('لطفاً تمام فیلدهای ضروری را پر کنید');
      return;
    }

    if (selectedItemStock !== null && parseFloat(formData.maqdar) > selectedItemStock) {
      alert(`موجودی کافی نیست. موجودی فعلی: ${selectedItemStock}`);
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch('http://localhost:3000/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'خطا در ثبت حواله');
      }

      alert('حواله خروج با موفقیت ثبت شد');
      setShowForm(false);
      setFormData({
        issue_num: '',
        tarikh: new Date().toISOString().split('T')[0],
        kala_id: '',
        maqdar: '',
        vahed: '',
        tahvil_gir: ''
      });
      setSelectedItemStock(null);
      fetchIssues();
    } catch (err) {
      alert('خطا: ' + err.message);
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
    <div className="issues-container">
      <div className="issues-header">
        <h1>خروج کالا</h1>
        <div className="header-buttons">
          <button className="btn-refresh" onClick={fetchIssues}>
            🔄 بروزرسانی
          </button>
          <button className="btn-new" onClick={() => setShowForm(true)}>
            + ثبت حواله جدید
          </button>
        </div>
      </div>

      <div className="issues-stats">
        <div className="stat-box">
          <div className="stat-label">کل حواله‌ها</div>
          <div className="stat-value">{issues.length}</div>
        </div>
      </div>

      <div className="issues-table-container">
        <table className="issues-table">
          <thead>
            <tr>
              <th>شماره حواله</th>
              <th>تاریخ</th>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>مقدار</th>
              <th>واحد</th>
              <th>تحویل گیرنده</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id}>
                <td className="issue-num">{issue.issue_num}</td>
                <td>{issue.tarikh}</td>
                <td className="kod-kala">{issue.kala_id}</td>
                <td>{issue.naam_kala}</td>
                <td className="maqdar">{issue.maqdar}</td>
                <td>{issue.vahed}</td>
                <td>{issue.tahvil_gir || '-'}</td>
              </tr>
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>ثبت حواله خروج جدید</h2>
              <button className="btn-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>شماره حواله *</label>
                  <input
                    type="text"
                    name="issue_num"
                    value={formData.issue_num}
                    onChange={handleInputChange}
                    required
                    placeholder="مثال: I-001"
                  />
                </div>

                <div className="form-group">
                  <label>تاریخ *</label>
                  <input
                    type="date"
                    name="tarikh"
                    value={formData.tarikh}
                    onChange={handleInputChange}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>کالا *</label>
                  <select
                    name="kala_id"
                    value={formData.kala_id}
                    onChange={handleInputChange}
                    required
                  >
                    <option value="">انتخاب کنید</option>
                    {items.map(item => (
                      <option key={item.kod_kala} value={item.kod_kala}>
                        {item.kod_kala} - {item.naam_kala} (موجودی: {item.mojoodi_fael})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedItemStock !== null && (
                  <div className="stock-info">
                    موجودی فعلی: <strong>{selectedItemStock}</strong> {formData.vahed}
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label>مقدار *</label>
                    <input
                      type="number"
                      name="maqdar"
                      value={formData.maqdar}
                      onChange={handleInputChange}
                      required
                      min="0"
                      step="0.01"
                      max={selectedItemStock || undefined}
                    />
                  </div>

                  <div className="form-group">
                    <label>واحد</label>
                    <input
                      type="text"
                      name="vahed"
                      value={formData.vahed}
                      onChange={handleInputChange}
                      readOnly
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>تحویل گیرنده</label>
                  <input
                    type="text"
                    name="tahvil_gir"
                    value={formData.tahvil_gir}
                    onChange={handleInputChange}
                    placeholder="نام تحویل گیرنده"
                  />
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
