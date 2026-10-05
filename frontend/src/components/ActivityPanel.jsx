import React from 'react';
import './ActivityPanel.css';

/**
 * A panel of recent documents with its "see everything" action.
 *
 * `onViewAll` navigates to the module this panel summarises. The button used to
 * have no handler at all, which read as a control that did something while doing
 * nothing. When no handler is supplied the button is not rendered rather than
 * rendered dead.
 */
export default function ActivityPanel({ title, rows, columns, onViewAll, viewAllLabel = 'مشاهده همه ←' }) {
  return (
    <div className="activity-panel">
      <div className="panel-header">
        <h3 className="panel-title">{title}</h3>
        {onViewAll && (
          <button
            type="button"
            className="view-all-btn"
            onClick={onViewAll}
            aria-label={`مشاهده همه ${title}`}
          >
            {viewAllLabel}
          </button>
        )}
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
