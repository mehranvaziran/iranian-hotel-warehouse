import React, { useState, useEffect } from 'react';
import './Items.css';

export default function Items() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  const [cardex, setCardex] = useState(null);
  const [showCardex, setShowCardex] = useState(false);
  const [cardexLoading, setCardexLoading] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formData, setFormData] = useState({
    kod_kala: '',
    naam_kala: '',
    goh: '',
    zirgoh: '',
    vahed: '',
    hadd_aqal_mojoodi: '',
    tavazihat: ''
  });

  const fetchItems = async () => {
    try {
      setLoading(true);
      const url = showInactive ? '/api/items?include_inactive=1' : '/api/items';
      const response = await fetch(url);
      if (!response.ok) throw new Error('خطا در دریافت اطلاعات');
      const data = await response.json();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  const groups = ['all', ...new Set(items.map(item => item.goh).filter(Boolean))];

  const filteredItems = items.filter(item => {
    const matchesSearch =
      item.naam_kala?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.kod_kala?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = selectedGroup === 'all' || item.goh === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const suggestCode = async (prefix) => {
    if (!prefix || prefix.trim().length === 0) return;
    try {
      const res = await fetch(`/api/items/suggest-code/${encodeURIComponent(prefix.trim().toUpperCase())}`);
      if (res.ok) {
        const data = await res.json();
        setFormData(prev => ({ ...prev, kod_kala: data.suggested_code }));
      }
    } catch (err) {
      console.error('Error suggesting code:', err);
    }
  };

  const openAddForm = async () => {
    setEditingItem(null);
    setFormError(null);
    setFormData({
      kod_kala: '', naam_kala: '', goh: '', zirgoh: '',
      vahed: '', hadd_aqal_mojoodi: '', tavazihat: ''
    });
    setShowForm(true);
    // Default prefix is K (items are coded K###)
    await suggestCode('K');
  };

  const openEditForm = (item) => {
    setEditingItem(item);
    setFormError(null);
    setFormData({
      kod_kala: item.kod_kala,
      naam_kala: item.naam_kala || '',
      goh: item.goh || '',
      zirgoh: item.zirgoh || '',
      vahed: item.vahed || '',
      hadd_aqal_mojoodi: item.hadd_aqal_mojoodi ?? '',
      tavazihat: item.tavazihat || ''
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.kod_kala || !formData.naam_kala) {
      setFormError('کد کالا و نام کالا الزامی است');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);

      const payload = {
        kod_kala: formData.kod_kala.trim(),
        naam_kala: formData.naam_kala.trim(),
        goh: formData.goh.trim(),
        zirgoh: formData.zirgoh.trim(),
        vahed: formData.vahed.trim(),
        hadd_aqal_mojoodi: Number(formData.hadd_aqal_mojoodi) || 0,
        tavazihat: formData.tavazihat.trim()
      };

      const isEditing = !!editingItem;
      const response = await fetch(
        isEditing ? `/api/items/${encodeURIComponent(payload.kod_kala)}` : '/api/items',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'خطا در ثبت کالا');
      }

      setShowForm(false);
      setEditingItem(null);
      fetchItems();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    const confirmMessage = item.is_active === 0
      ? `این کالا غیرفعال است. حذف شود؟\nکد: ${item.kod_kala} - ${item.naam_kala}`
      : `آیا از حذف/غیرفعال کردن این کالا مطمئن هستید؟\nکد: ${item.kod_kala} - ${item.naam_kala}\n(در صورت وجود سابقه حرکت، کالا غیرفعال می‌شود)`;

    if (!window.confirm(confirmMessage)) return;

    try {
      const response = await fetch(`/api/items/${encodeURIComponent(item.kod_kala)}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'خطا در حذف کالا');
      }

      const result = await response.json();
      alert(result.message);
      fetchItems();
    } catch (err) {
      alert('خطا: ' + err.message);
    }
  };

  const handleItemClick = (item) => {
    setSelectedItem(item);
    setShowDetails(true);
  };

  const handleViewCardex = async (item) => {
    setSelectedItem(item);
    setShowDetails(false);
    setShowCardex(true);
    setCardex(null);
    setCardexLoading(true);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.kod_kala)}/cardex`);
      if (!res.ok) throw new Error('خطا در دریافت کارتکس');
      setCardex(await res.json());
    } catch (err) {
      setCardex([]);
    } finally {
      setCardexLoading(false);
    }
  };

  const closeDetails = () => {
    setShowDetails(false);
    setSelectedItem(null);
  };

  const closeCardex = () => {
    setShowCardex(false);
    setSelectedItem(null);
    setCardex(null);
  };

  const stockClass = (item) =>
    Number(item.current_stock) < Number(item.hadd_aqal_mojoodi) ? 'mojoodi-low' : 'mojoodi';

  if (loading) {
    return <div className="loading">در حال بارگذاری...</div>;
  }

  if (error) {
    return <div className="error">خطا: {error}</div>;
  }

  return (
    <div className="items-container">
      <div className="items-header">
        <h1>مدیریت کالاها</h1>
        <div className="header-buttons">
          <button className="btn-refresh" onClick={fetchItems}>
            🔄 بروزرسانی
          </button>
          <button className="btn-new" onClick={openAddForm}>
            + کالای جدید
          </button>
        </div>
      </div>

      <div className="items-filters">
        <input
          type="text"
          className="search-input"
          placeholder="جستجو بر اساس نام یا کد کالا..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <select
          className="group-filter"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
        >
          <option value="all">همه گروه‌ها</option>
          {groups.filter(g => g !== 'all').map(group => (
            <option key={group} value={group}>{group}</option>
          ))}
        </select>

        <label className="inactive-toggle">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          نمایش کالاهای غیرفعال
        </label>
      </div>

      <div className="items-stats">
        <div className="stat-item">
          <span className="stat-label">کل کالاها:</span>
          <span className="stat-value">{filteredItems.length.toLocaleString('fa-IR')}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">دارای موجودی:</span>
          <span className="stat-value">{filteredItems.filter(i => Number(i.current_stock) > 0).length.toLocaleString('fa-IR')}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">غیرفعال:</span>
          <span className="stat-value">{filteredItems.filter(i => i.is_active === 0).length.toLocaleString('fa-IR')}</span>
        </div>
      </div>

      <div className="items-table-container">
        <table className="items-table">
          <thead>
            <tr>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>گروه</th>
              <th>زیرگروه</th>
              <th>واحد</th>
              <th>موجودی فعلی</th>
              <th>حد اقل موجودی</th>
              <th>وضعیت</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.kod_kala} className={item.is_active === 0 ? 'row-inactive' : ''}>
                <td className="kod-kala">{item.kod_kala}</td>
                <td className="naam-kala">{item.naam_kala}</td>
                <td>{item.goh}</td>
                <td>{item.zirgoh || '-'}</td>
                <td>{item.vahed}</td>
                <td className={stockClass(item)}>
                  {Number(item.current_stock).toLocaleString('fa-IR')}
                </td>
                <td>{Number(item.hadd_aqal_mojoodi).toLocaleString('fa-IR')}</td>
                <td>
                  {item.is_active === 0
                    ? <span className="status-badge status-inactive">غیرفعال</span>
                    : Number(item.current_stock) === 0
                      ? <span className="status-badge status-empty">تمام شده</span>
                      : Number(item.current_stock) < Number(item.hadd_aqal_mojoodi)
                        ? <span className="status-badge status-low">زیر حد مجاز</span>
                        : <span className="status-badge status-ok">موجود</span>}
                </td>
                <td>
                  <div className="row-actions">
                    <button className="btn-details" onClick={() => handleItemClick(item)}>
                      جزئیات
                    </button>
                    <button className="btn-cardex" onClick={() => handleViewCardex(item)}>
                      کارتکس
                    </button>
                    <button className="btn-edit" onClick={() => openEditForm(item)}>
                      ویرایش
                    </button>
                    <button className="btn-delete" onClick={() => handleDelete(item)}>
                      حذف
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredItems.length === 0 && (
        <div className="empty-state">
          هیچ کالایی یافت نشد
        </div>
      )}

      {/* Details modal */}
      {showDetails && selectedItem && (
        <div className="modal-overlay" onClick={closeDetails}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>جزئیات کالا</h2>
              <button className="btn-close" onClick={closeDetails}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-row">
                <span className="detail-label">کد کالا:</span>
                <span className="detail-value">{selectedItem.kod_kala}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">نام کالا:</span>
                <span className="detail-value">{selectedItem.naam_kala}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">گروه:</span>
                <span className="detail-value">{selectedItem.goh || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">زیرگروه:</span>
                <span className="detail-value">{selectedItem.zirgoh || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">واحد:</span>
                <span className="detail-value">{selectedItem.vahed || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">موجودی مبنا:</span>
                <span className="detail-value">{Number(selectedItem.baseline_qty || 0).toLocaleString('fa-IR')}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">جمع ورود:</span>
                <span className="detail-value">{Number(selectedItem.total_receipts || 0).toLocaleString('fa-IR')}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">جمع خروج:</span>
                <span className="detail-value">{Number(selectedItem.total_issues || 0).toLocaleString('fa-IR')}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">موجودی فعلی:</span>
                <span className="detail-value highlight">
                  {Number(selectedItem.current_stock || 0).toLocaleString('fa-IR')} {selectedItem.vahed}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">حد اقل موجودی:</span>
                <span className="detail-value">{Number(selectedItem.hadd_aqal_mojoodi || 0).toLocaleString('fa-IR')} {selectedItem.vahed}</span>
              </div>
              {selectedItem.tavazihat && (
                <div className="detail-row">
                  <span className="detail-label">توضیحات:</span>
                  <span className="detail-value">{selectedItem.tavazihat}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-modal" onClick={() => handleViewCardex(selectedItem)}>
                مشاهده کارتکس
              </button>
              <button className="btn-modal" onClick={closeDetails}>بستن</button>
            </div>
          </div>
        </div>
      )}

      {/* Cardex modal */}
      {showCardex && selectedItem && (
        <div className="modal-overlay" onClick={closeCardex}>
          <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>کارتکس کالا - {selectedItem.kod_kala}</h2>
              <button className="btn-close" onClick={closeCardex}>×</button>
            </div>
            <div className="modal-body">
              <div className="cardex-summary">
                <span><strong>{selectedItem.naam_kala}</strong></span>
                <span>موجودی فعلی: <strong>{Number(selectedItem.current_stock || 0).toLocaleString('fa-IR')}</strong> {selectedItem.vahed}</span>
              </div>
              {cardexLoading ? (
                <div className="loading">در حال بارگذاری کارتکس...</div>
              ) : cardex && cardex.length > 0 ? (
                <div className="cardex-table-container">
                  <table className="cardex-table">
                    <thead>
                      <tr>
                        <th>ردیف</th>
                        <th>نوع حرکت</th>
                        <th>تاریخ</th>
                        <th>شماره سند</th>
                        <th>ورود</th>
                        <th>خروج</th>
                        <th>مانده</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cardex.map((row, idx) => (
                        <tr key={idx}>
                          <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                          <td>
                            {row.type === 'baseline' ? 'موجودی مبنا' : row.type === 'receipt' ? 'ورود' : 'خروج'}
                          </td>
                          <td>{row.date || '-'}</td>
                          <td>{row.doc_num || '-'}</td>
                          <td className="qty-in">{row.receipt_qty ? Number(row.receipt_qty).toLocaleString('fa-IR') : '-'}</td>
                          <td className="qty-out">{row.issue_qty ? Number(row.issue_qty).toLocaleString('fa-IR') : '-'}</td>
                          <td className="qty-balance">{Number(row.balance).toLocaleString('fa-IR')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">حرکتی برای این کالا ثبت نشده است</div>
              )}
            </div>
            <div className="modal-footer">
              <button
                className="btn-modal btn-print"
                onClick={() => window.open(`/api/print/cardex/${encodeURIComponent(selectedItem.kod_kala)}`, '_blank')}
              >
                🖨️ چاپ کارتکس
              </button>
              <button className="btn-modal" onClick={closeCardex}>بستن</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / edit form modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingItem(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingItem ? 'ویرایش کالا' : 'کالای جدید'}</h2>
              <button className="btn-close" onClick={() => { setShowForm(false); setEditingItem(null); }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {formError && <div className="form-error">{formError}</div>}

                <div className="form-group">
                  <label>کد کالا *</label>
                  <div className="code-row">
                    <input
                      type="text"
                      name="kod_kala"
                      value={formData.kod_kala}
                      onChange={handleInputChange}
                      required
                      placeholder="مثال: K019"
                      disabled={!!editingItem}
                    />
                    {!editingItem && (
                      <button
                        type="button"
                        className="btn-suggest"
                        onClick={() => suggestCode(formData.kod_kala || 'K')}
                      >
                        پیشنهاد کد
                      </button>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label>نام کالا *</label>
                  <input
                    type="text"
                    name="naam_kala"
                    value={formData.naam_kala}
                    onChange={handleInputChange}
                    required
                    placeholder="نام کالا"
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>گروه</label>
                    <input
                      type="text"
                      name="goh"
                      value={formData.goh}
                      onChange={handleInputChange}
                      placeholder="مثال: کناف"
                    />
                  </div>

                  <div className="form-group">
                    <label>زیرگروه</label>
                    <input
                      type="text"
                      name="zirgoh"
                      value={formData.zirgoh}
                      onChange={handleInputChange}
                      placeholder="زیرگروه"
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>واحد</label>
                    <input
                      type="text"
                      name="vahed"
                      value={formData.vahed}
                      onChange={handleInputChange}
                      placeholder="مثال: شاخه"
                    />
                  </div>

                  <div className="form-group">
                    <label>حد اقل موجودی</label>
                    <input
                      type="number"
                      name="hadd_aqal_mojoodi"
                      value={formData.hadd_aqal_mojoodi}
                      onChange={handleInputChange}
                      min="0"
                      step="0.01"
                      placeholder="0"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>توضیحات</label>
                  <textarea
                    name="tavazihat"
                    value={formData.tavazihat}
                    onChange={handleInputChange}
                    placeholder="توضیحات"
                    rows={2}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-cancel" onClick={() => { setShowForm(false); setEditingItem(null); }}>
                  انصراف
                </button>
                <button type="submit" className="btn-submit" disabled={submitting}>
                  {submitting ? 'در حال ثبت...' : editingItem ? 'ذخیره تغییرات' : 'ثبت کالا'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
