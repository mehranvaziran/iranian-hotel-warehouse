import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import './App.css';

export default function App() {
  const [activePage, setActivePage] = useState('dashboard');

  return (
    <div className="app-container">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <div className="main-content">
        <Header />
        <div className="content-area">
          {activePage === 'dashboard' && <Dashboard />}
          {activePage === 'items' && <div className="placeholder">صفحه کالاها - در دست توسعه</div>}
          {activePage === 'receipts' && <div className="placeholder">صفحه رسید انبار - در دست توسعه</div>}
          {activePage === 'issues' && <div className="placeholder">صفحه خروج انبار - در دست توسعه</div>}
          {activePage === 'inventory' && <div className="placeholder">صفحه موجودی - در دست توسعه</div>}
          {activePage === 'reports' && <div className="placeholder">صفحه گزارشات - در دست توسعه</div>}
          {activePage === 'settings' && <div className="placeholder">صفحه تنظیمات - در دست توسعه</div>}
        </div>
      </div>
    </div>
  );
}
