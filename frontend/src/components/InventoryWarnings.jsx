import React from 'react';
import './InventoryWarnings.css';

export default function InventoryWarnings({ warnings }) {
  return (
    <div className="warnings-panel">
      <div className="warnings-header">
        <h3 className="warnings-title">⚠️ هشدار موجودی</h3>
        {warnings && warnings.length > 0 && (
          <span className="warning-badge">{warnings.length}</span>
        )}
      </div>

      {warnings && warnings.length > 0 ? (
        <div className="warnings-list">
          {warnings.map((warning, idx) => (
            <div key={idx} className="warning-item">
              <div className="warning-item-header">
                <div className="warning-item-code">{warning.kod_kala}</div>
                <div className="warning-item-status critical">
                  {Math.round(((warning.current_stock / warning.hadd_aqal_mojoodi) * 100) || 0)}%
                </div>
              </div>
              <div className="warning-item-name">{warning.naam_kala}</div>
              <div className="warning-item-details">
                <div className="detail">
                  <span className="label">موجود:</span>
                  <span className="value">{Number(warning.current_stock).toLocaleString('fa-IR')} {warning.vahed}</span>
                </div>
                <div className="detail">
                  <span className="label">حداقل:</span>
                  <span className="value">{Number(warning.hadd_aqal_mojoodi).toLocaleString('fa-IR')} {warning.vahed}</span>
                </div>
              </div>
              <div className="warning-item-gap">
                کمبود: {Math.max(0, warning.hadd_aqal_mojoodi - warning.current_stock).toLocaleString('fa-IR')} {warning.vahed}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="warnings-empty">
          <p>✅ هیچ کمبودی وجود ندارد</p>
        </div>
      )}
    </div>
  );
}
