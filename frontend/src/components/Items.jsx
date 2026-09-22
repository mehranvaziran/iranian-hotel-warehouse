import React, { useState, useEffect } from 'react';
import './Items.css';

export default function Items() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000/api/items');
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

  const groups = ['all', ...new Set(items.map(item => item.goh).filter(Boolean))];

  const filteredItems = items.filter(item => {
    const matchesSearch =
      item.naam_kala?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.kod_kala?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = selectedGroup === 'all' || item.goh === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  const handleItemClick = (item) => {
    setSelectedItem(item);
    setShowDetails(true);
  };

  const closeDetails = () => {
    setShowDetails(false);
    setSelectedItem(null);
  };

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
        <button className="btn-refresh" onClick={fetchItems}>
          🔄 بروزرسانی
        </button>
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
      </div>

      <div className="items-stats">
        <div className="stat-item">
          <span className="stat-label">کل کالاها:</span>
          <span className="stat-value">{filteredItems.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">دارای موجودی:</span>
          <span className="stat-value">{filteredItems.filter(i => i.mojoodi_fael > 0).length}</span>
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
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((item) => (
              <tr key={item.id}>
                <td className="kod-kala">{item.kod_kala}</td>
                <td className="naam-kala">{item.naam_kala}</td>
                <td>{item.goh}</td>
                <td>{item.zirgoh || '-'}</td>
                <td>{item.vahed}</td>
                <td className={item.mojoodi_fael < item.hadd_aqal_mojoodi ? 'mojoodi-low' : 'mojoodi'}>
                  {item.mojoodi_fael}
                </td>
                <td>{item.hadd_aqal_mojoodi}</td>
                <td>
                  <button
                    className="btn-details"
                    onClick={() => handleItemClick(item)}
                  >
                    جزئیات
                  </button>
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
                <span className="detail-value">{selectedItem.goh}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">زیرگروه:</span>
                <span className="detail-value">{selectedItem.zirgoh || '-'}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">واحد:</span>
                <span className="detail-value">{selectedItem.vahed}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">موجودی فعلی:</span>
                <span className="detail-value highlight">{selectedItem.mojoodi_fael} {selectedItem.vahed}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">حد اقل موجودی:</span>
                <span className="detail-value">{selectedItem.hadd_aqal_mojoodi} {selectedItem.vahed}</span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-modal" onClick={closeDetails}>بستن</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
