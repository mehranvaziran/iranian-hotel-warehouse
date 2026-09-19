import React, { useState } from 'react';
import './Header.css';

export default function Header() {
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <header className="header">
      <div className="header-left">
        <div className="header-title-area">
          <h1 className="header-title">پروژه توسعه هتل ایرانیان</h1>
          <p className="header-subtitle">سامانه هوشمند مدیریت انبار توسعه</p>
        </div>
      </div>

      <div className="header-center">
        <div className="search-container">
          <input
            type="text"
            placeholder="جستجو..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          <span className="search-icon">🔍</span>
        </div>
      </div>

      <div className="header-right">
        <button className="header-icon-btn notification-btn">
          <span className="icon">🔔</span>
          <span className="badge">3</span>
        </button>

        <div className="user-section">
          <div className="user-avatar">م</div>
          <div className="user-info">
            <div className="user-name">مدیر انبار</div>
            <div className="user-role">هتل ایرانیان</div>
          </div>
        </div>
      </div>
    </header>
  );
}
