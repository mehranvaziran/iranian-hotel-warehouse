import React from 'react';
import './RecentActivity.css';

export default function RecentActivity({ activity }) {
  return (
    <div className="activity-timeline">
      <h3 className="timeline-title">📅 آخرین فعالیت‌ها</h3>

      {activity && activity.length > 0 ? (
        <div className="timeline-list">
          {activity.map((item, idx) => (
            <div key={idx} className="timeline-item">
              <div className="timeline-marker">
                {item.type === 'receipt' && '📥'}
                {item.type === 'issue' && '📤'}
                {!item.type && '📝'}
              </div>
              <div className="timeline-content">
                <p className="timeline-description">{item.description}</p>
                <p className="timeline-time">{item.timestamp}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="timeline-empty">
          <p>فعالیتی ثبت نشده است</p>
        </div>
      )}
    </div>
  );
}
