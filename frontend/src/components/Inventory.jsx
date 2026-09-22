import React, { useState, useEffect } from 'react';
import './Inventory.css';

export default function Inventory() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('all');

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3000/api/inventory');
      if (!response.ok) throw new Error('خطا در دریافت اطلاعات');
      const data = await response.json();
      setInventory(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const groups = ['all', ...new Set(inventory.map(item => item.goh).filter(Boolean))];

  const filteredInventory = inventory.filter(item => {
    const matchesSearch =
      item.naam_kala?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.kod_kala?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = selectedGroup === 'all' || item.goh === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  const getStatusBadge = (item) => {
    if (item.mojoodi_fael === 0) {
      return <span className="status-badge status-empty">تمام شده</span>;
    } else if (item.mojoodi_fael < item.hadd_aqal_mojoodi) {
      return <span className="status-badge status-low">زیر حد مجاز</span>;
    } else {
      return <span className="status-badge status-ok">موجود</span>;
    }
  };

  if (loading) {
    return <div className="loading">در حال بارگذاری...</div>;
  }

  if (error) {
    return <div className="error">خطا: {error}</div>;
  }

  return (
    <div className="inventory-container">
      <div className="inventory-header">
        <h1>موجودی انبار</h1>
        <button className="btn-refresh" onClick={fetchInventory}>
          🔄 بروزرسانی
        </button>
      </div>

      <div className="inventory-filters">
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

      <div className="inventory-stats">
        <div className="stat-card">
          <div className="stat-label">کل کالاها</div>
          <div className="stat-value">{filteredInventory.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">موجود</div>
          <div className="stat-value">
            {filteredInventory.filter(i => i.mojoodi_fael > 0).length}
          </div>
        </div>
        <div className="stat-card warning">
          <div className="stat-label">زیر حد مجاز</div>
          <div className="stat-value">
            {filteredInventory.filter(i => i.mojoodi_fael < i.hadd_aqal_mojoodi && i.mojoodi_fael > 0).length}
          </div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">تمام شده</div>
          <div className="stat-value">
            {filteredInventory.filter(i => i.mojoodi_fael === 0).length}
          </div>
        </div>
      </div>

      <div className="inventory-table-container">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>گروه</th>
              <th>زیرگروه</th>
              <th>موجودی فعلی</th>
              <th>حد اقل</th>
              <th>واحد</th>
              <th>کل ورود</th>
              <th>کل خروج</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {filteredInventory.map((item) => (
              <tr key={item.kod_kala} className={item.mojoodi_fael < item.hadd_aqal_mojoodi ? 'row-warning' : ''}>
                <td className="kod-kala">{item.kod_kala}</td>
                <td className="naam-kala">{item.naam_kala}</td>
                <td>{item.goh}</td>
                <td>{item.zirgoh || '-'}</td>
                <td className="mojoodi">{item.mojoodi_fael}</td>
                <td>{item.hadd_aqal_mojoodi}</td>
                <td>{item.vahed}</td>
                <td>{item.total_receipts}</td>
                <td>{item.total_issues}</td>
                <td>{getStatusBadge(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredInventory.length === 0 && (
        <div className="empty-state">
          هیچ کالایی یافت نشد
        </div>
      )}
    </div>
  );
}
