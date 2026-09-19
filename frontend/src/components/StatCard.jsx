import React from 'react';
import './StatCard.css';

export default function StatCard({ title, value, icon, color = 'default', trend = 'stable' }) {
  return (
    <div className={`stat-card stat-card--${color}`}>
      <div className="stat-card-content">
        <div className="stat-card-header">
          <div className="stat-card-title">{title}</div>
          <div className="stat-card-icon">{icon}</div>
        </div>
        <div className="stat-card-value">{typeof value === 'number' ? value.toLocaleString('fa-IR') : value}</div>
        <div className={`stat-card-trend trend-${trend}`}>
          {trend === 'up' && '📈 درحال افزایش'}
          {trend === 'down' && '📉 کاهشی'}
          {trend === 'alert' && '🚨 نیاز توجه'}
          {trend === 'stable' && '➡️ پایدار'}
        </div>
      </div>
    </div>
  );
}
