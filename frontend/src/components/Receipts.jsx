import React, { useState, useEffect } from 'react';
import './Receipts.css';

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    receipt_num: '',
    tarikh: new Date().toISOString().split('T')[0],
    kala_id: '',
    maqdar: '',
    vahed: ''
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReceipts();
    fetchItems();
  }, []);

  const fetchReceipts = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000/api/receipts');
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
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.receipt_num || !formData.kala_id || !formData.maqdar) {
      alert('لطفاً تمام فیلدهای ضروری را پر کنید');
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch('http://localhost:3000/api/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'خطا در ثبت رسید');
      }

      alert('رسید با موفقیت ثبت شد');
      setShowForm(false);
      setFormData({
        receipt_num: '',
        tarikh: new Date().toISOString().split('T')[0],
        kala_id: '',
        maqdar: '',
        vahed: ''
      });
      fetchReceipts();
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
    <div className="receipts-container">
      <div className="receipts-header">
        <h1>ورود کالا</h1>
        <div className="header-buttons">
          <button className="btn-refresh" onClick={fetchReceipts}>
            🔄 بروزرسانی
          </button>
          <button className="btn-new" onClick={() => setShowForm(true)}>
            + ثبت رسید جدید
          </button>
        </div>
      </div>

      <div className="receipts-stats">
        <div className="stat-box">
          <div className="stat-label">کل رسیدها</div>
          <div className="stat-value">{receipts.length}</div>
        </div>
      </div>

      <div className="receipts-table-container">
        <table className="receipts-table">
          <thead>
            <tr>
              <th>شماره رسید</th>
              <th>تاریخ</th>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>مقدار</th>
              <th>واحد</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id}>
                <td className="receipt-num">{receipt.receipt_num}</td>
                <td>{receipt.tarikh}</td>
                <td className="kod-kala">{receipt.kala_id}</td>
                <td>{receipt.naam_kala}</td>
                <td className="maqdar">{receipt.maqdar}</td>
                <td>{receipt.vahed}</td>
              </tr>
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>ثبت رسید ورود جدید</h2>
              <button className="btn-close" onClick={() => setShowForm(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>شماره رسید *</label>
                  <input
                    type="text"
                    name="receipt_num"
                    value={formData.receipt_num}
                    onChange={handleInputChange}
                    required
                    placeholder="مثال: R-001"
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
                        {item.kod_kala} - {item.naam_kala}
                      </option>
                    ))}
                  </select>
                </div>

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
