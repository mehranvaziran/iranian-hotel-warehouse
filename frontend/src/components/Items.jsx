import React, { useState, useEffect, useRef } from 'react';
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
  const [cardexError, setCardexError] = useState(null);
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
  // The canonical group list, in its stored display order. Group order is data
  // held in the database, not an alphabetic convention derived here.
  const [groups, setGroups] = useState([]);
  // What the catalog already uses for the prefix the user is typing. `null` is
  // "nothing to suggest"; the panel is hidden then.
  const [codeHint, setCodeHint] = useState(null);
  const hintSeq = useRef(0);
  const hintTimer = useRef(null);

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

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/groups');
      if (!res.ok) throw new Error('خطا در دریافت گروه‌ها');
      setGroups(await res.json());
    } catch {
      // The group filter falls back to the groups present on the loaded items.
      setGroups((prev) => prev);
    }
  };

  useEffect(() => {
    fetchItems();
    fetchGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  // The ordered list used by the filter. Falls back to the groups present on the
  // loaded items when the canonical table could not be read, so the filter never
  // empties because a reference request failed.
  const groupOptions =
    groups.length > 0
      ? groups.map((g) => g.name)
      : [...new Set(items.map((item) => item.goh).filter(Boolean))];

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
    if (name === 'kod_kala') refreshCodeHint(value);
  };

  /**
   * Look up what the catalog already uses for the prefix being typed, so the
   * field can offer the next free code. The prefix is read by the API from the
   * typed text — the shape of a code lives in one place, and this does not
   * re-parse it in the browser.
   *
   * The reply is a *suggestion*. It never writes into the field: the user's code
   * is kept until the suggestion button is clicked. This replaces the
   * "پیشنهاد کد" button, which overwrote whatever the user had started typing,
   * and the auto-fill on opening the form, which filled a code nobody had asked
   * for. Debounced and sequenced, so a fast typist sees the answer to the
   * keystrokes just typed and not an answer to earlier ones.
   */
  const refreshCodeHint = (typed) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    const value = String(typed ?? '');
    if (!value.trim()) {
      setCodeHint(null);
      return;
    }
    const seq = ++hintSeq.current;
    hintTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items/suggest-code/${encodeURIComponent(value.trim())}`);
        if (!res.ok) { setCodeHint(null); return; }
        const data = await res.json();
        if (seq !== hintSeq.current) return; // a later keystroke is already answered
        // No letters in the typed text means no prefix to suggest from.
        if (!data.prefix) { setCodeHint(null); return; }
        setCodeHint({ prefix: data.prefix, last: data.last_code, suggested: data.suggested_code });
      } catch {
        // The hint is a convenience; a failed fetch hides it and the user types
        // the code by hand exactly as before.
        setCodeHint(null);
      }
    }, 220);
  };

  const openAddForm = async () => {
    setEditingItem(null);
    setFormError(null);
    setCodeHint(null);
    setFormData({
      kod_kala: '', naam_kala: '', goh: '', zirgoh: '',
      vahed: '', hadd_aqal_mojoodi: '', tavazihat: ''
    });
    setShowForm(true);
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
        zirgoh: formData.zirgoh.trim(),
        hadd_aqal_mojoodi: Number(formData.hadd_aqal_mojoodi) || 0,
        tavazihat: formData.tavazihat.trim()
      };

      if (editingItem) {
        // Group and unit are locked once an item exists — they identify it in
        // every document, and the unit is what document lines store. The backend
        // enforces this too; sending them unchanged would also pass, but sending
        // the editable fields only keeps a stale form from re-submitting a
        // locked one.
        payload.is_active = editingItem.is_active === 0 ? 0 : 1;
      } else {
        payload.goh = formData.goh.trim();
        payload.vahed = formData.vahed.trim();
      }

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

  // An item is retired by deactivation, not deletion, so it keeps its stock and
  // history. Re-enabling it puts it back in the catalog for new documents.
  const handleReactivate = async (item) => {
    if (!window.confirm(`این کالا مجدداً فعال شود؟\nکد: ${item.kod_kala} - ${item.naam_kala}`)) return;

    try {
      const response = await fetch(`/api/items/${encodeURIComponent(item.kod_kala)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          naam_kala: item.naam_kala,
          zirgoh: item.zirgoh || '',
          hadd_aqal_mojoodi: item.hadd_aqal_mojoodi || 0,
          tavazihat: item.tavazihat || '',
          is_active: 1,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'خطا در فعال‌سازی کالا');
      }

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
    setCardexError(null);
    setCardexLoading(true);
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(item.kod_kala)}/cardex`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'خطا در دریافت کارتکس');
      setCardex(data);
    } catch (err) {
      // An empty array here would be indistinguishable from "no movements",
      // which hides a real server failure behind a reassuring message.
      setCardexError(err.message);
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
          {groupOptions.map((group) => (
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
                  <div className="row-actions" role="group" aria-label="عملیات کالا">
                    <button
                      type="button"
                      className="action-icon action-details"
                      title="جزئیات کالا"
                      aria-label="جزئیات کالا"
                      onClick={() => handleItemClick(item)}
                    >
                      ℹ️
                    </button>
                    <button
                      type="button"
                      className="action-icon action-cardex"
                      title="کارتکس کالا"
                      aria-label="کارتکس کالا"
                      onClick={() => handleViewCardex(item)}
                    >
                      🗂️
                    </button>
                    {item.is_active === 0 && (
                      <button
                        type="button"
                        className="action-icon action-reactivate"
                        title="فعال‌سازی مجدد کالا"
                        aria-label="فعال‌سازی مجدد کالا"
                        onClick={() => handleReactivate(item)}
                      >
                        ♻️
                      </button>
                    )}
                    <button
                      type="button"
                      className="action-icon action-edit"
                      title="ویرایش کالا"
                      aria-label="ویرایش کالا"
                      onClick={() => openEditForm(item)}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="action-icon action-delete"
                      title="حذف کالا — در صورت وجود سابقه حرکت، کالا غیرفعال می‌شود"
                      aria-label="حذف کالا"
                      onClick={() => handleDelete(item)}
                    >
                      🗑️
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
              ) : cardexError ? (
                <div className="cardex-error">
                  <span>⚠️ {cardexError}</span>
                  <button
                    type="button"
                    className="btn-retry-cardex"
                    onClick={() => selectedItem && handleViewCardex(selectedItem)}
                  >
                    تلاش مجدد
                  </button>
                </div>
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
                  </div>
                  {!editingItem && codeHint && (codeHint.last || codeHint.suggested) && (
                    <div className="code-hint" role="note">
                      {codeHint.last ? (
                        <span>
                          آخرین کد ثبت‌شده با پیشوند «{codeHint.prefix}»:{' '}
                          <strong dir="ltr">{codeHint.last}</strong>
                        </span>
                      ) : (
                        <span>کالایی با پیشوند «{codeHint.prefix}» هنوز ثبت نشده است.</span>
                      )}
                      {codeHint.suggested && (
                        <button
                          type="button"
                          className="btn-hint"
                          title="این کد در فیلد بالا قرار می‌گیرد؛ می‌توانید پس از آن نیز آن را تغییر دهید"
                          onClick={() => {
                            setFormData(prev => ({ ...prev, kod_kala: codeHint.suggested }));
                            setCodeHint(null);
                          }}
                        >
                          استفاده از کد {codeHint.suggested}
                        </button>
                      )}
                    </div>
                  )}
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
                    <label>گروه {editingItem && '(غیرقابل تغییر)'}</label>
                    <input
                      type="text"
                      name="goh"
                      value={formData.goh}
                      onChange={handleInputChange}
                      placeholder="مثال: کناف"
                      // Locked once the item exists. When creating, free text is
                      // kept so a new group can be typed; the canonical list is
                      // offered as suggestions, not as a closed set.
                      disabled={!!editingItem}
                      list="group-options"
                    />
                    <datalist id="group-options">
                      {groupOptions.map((g) => (
                        <option key={g} value={g} />
                      ))}
                    </datalist>
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
                    <label>واحد {editingItem && '(غیرقابل تغییر)'}</label>
                    <input
                      type="text"
                      name="vahed"
                      value={formData.vahed}
                      onChange={handleInputChange}
                      placeholder="مثال: شاخه"
                      disabled={!!editingItem}
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
