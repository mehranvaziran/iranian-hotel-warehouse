import React from 'react';
import './Sidebar.css';

const navigationItems = [
  { id: 'dashboard', label: 'داشبورد', icon: '📊' },
  { id: 'items', label: 'کالاها', icon: '📦' },
  { id: 'receipts', label: 'رسید انبار', icon: '📥' },
  { id: 'issues', label: 'خروج انبار', icon: '📤' },
  { id: 'inventory', label: 'موجودی', icon: '📋' },
  { id: 'reports', label: 'گزارشات و چاپ', icon: '🖨️' },
  { id: 'settings', label: 'تنظیمات', icon: '⚙️' },
];

export default function Sidebar({ activePage, setActivePage }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">🏨</div>
        <div className="brand-text">
          <div className="brand-title">ایرانیان</div>
          <div className="brand-subtitle">انبار</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navigationItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activePage === item.id ? 'active' : ''}`}
            onClick={() => setActivePage(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="system-info">
          <div className="system-version">نسخه 1.0.0</div>
          <div className="system-status">آنلاین</div>
        </div>
      </div>
    </aside>
  );
}
