import React from 'react';
import './ActivityPanel.css';

export default function ActivityPanel({ title, rows, columns }) {
  return (
    <div className="activity-panel">
      <div className="panel-header">
        <h3 className="panel-title">{title}</h3>
        <button className="view-all-btn">مشاهده همه →</button>
      </div>

      {rows && rows.length > 0 ? (
        <div className="table-container">
          <table className="activity-table">
            <thead>
              <tr>
                {columns.map((col, idx) => (
                  <th key={idx}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx}>
                  {row.map((cell, cellIdx) => (
                    <td key={cellIdx}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <p>داده‌ای برای نمایش وجود ندارد</p>
        </div>
      )}
    </div>
  );
}
