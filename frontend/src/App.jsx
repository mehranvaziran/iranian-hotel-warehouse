import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import Inventory from './components/Inventory';
import Items from './components/Items';
import Receipts from './components/Receipts';
import Issues from './components/Issues';
import Reports from './components/Reports';
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
          {activePage === 'items' && <Items />}
          {activePage === 'receipts' && <Receipts />}
          {activePage === 'issues' && <Issues />}
          {activePage === 'inventory' && <Inventory />}
          {activePage === 'reports' && <Reports />}
          {activePage === 'settings' && <div className="placeholder">صفحه تنظیمات - در دست توسعه</div>}
        </div>
      </div>
    </div>
  );
}
