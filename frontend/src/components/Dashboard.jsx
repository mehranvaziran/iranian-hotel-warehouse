import React, { useState, useEffect } from 'react';
import StatCard from './StatCard';
import ActivityPanel from './ActivityPanel';
import InventoryWarnings from './InventoryWarnings';
import RecentActivity from './RecentActivity';
import './Dashboard.css';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recentReceipts, setRecentReceipts] = useState([]);
  const [recentIssues, setRecentIssues] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const [statsRes, receiptsRes, issuesRes, warningsRes, activityRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/recent-receipts'),
          fetch('/api/dashboard/recent-issues'),
          fetch('/api/dashboard/warnings'),
          fetch('/api/dashboard/activity'),
        ]);

        if (!statsRes.ok) throw new Error('Failed to fetch stats');

        setStats(await statsRes.json());
        if (receiptsRes.ok) setRecentReceipts(await receiptsRes.json());
        if (issuesRes.ok) setRecentIssues(await issuesRes.json());
        if (warningsRes.ok) setWarnings(await warningsRes.json());
        if (activityRes.ok) setActivity(await activityRes.json());
        setError(null);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return <div className="dashboard-loading">در حال بارگذاری...</div>;
  }

  if (error) {
    return <div className="dashboard-error">خطا: {error}</div>;
  }

  return (
    <div className="dashboard">
      {/* Statistics Section */}
      <section className="stats-section">
        <div className="stats-grid">
          <StatCard
            title="موجودی کل"
            value={stats?.totalInventory || 0}
            icon="📦"
            trend="stable"
          />
          <StatCard
            title="کالاهای دارای موجودی"
            value={stats?.stockedItems || 0}
            icon="🏷️"
            trend="up"
          />
          <StatCard
            title="کمبودها"
            value={stats?.minStockWarnings || 0}
            icon="⚠️"
            color="warning"
            trend="alert"
          />
          <StatCard
            title="تمام‌شده‌ها"
            value={stats?.outOfStockItems || 0}
            icon="✅"
            color="success"
            trend="stable"
          />
        </div>
      </section>

      {/* Main Content Grid */}
      <section className="main-grid">
        {/* Recent Activity Panels */}
        <div className="activity-section">
          <ActivityPanel
            title="آخرین ورودها"
            rows={recentReceipts.map(r => [
              r.receipt_number,
              r.tarikh,
              `${r.item_count} قلم`,
              `${Number(r.total_quantity || 0).toLocaleString('fa-IR')}`,
            ])}
            columns={['شماره رسید', 'تاریخ', 'تعداد اقلام', 'مقدار کل']}
          />

          <ActivityPanel
            title="آخرین خروج‌ها"
            rows={recentIssues.map(i => [
              i.issue_number,
              i.tarikh,
              `${i.item_count} قلم`,
              `${Number(i.total_quantity || 0).toLocaleString('fa-IR')}`,
              i.tahvil_gir || '-',
            ])}
            columns={['شماره حواله', 'تاریخ', 'تعداد اقلام', 'مقدار کل', 'تحویل‌گیرنده']}
          />
        </div>

        {/* Right Column */}
        <div className="sidebar-section">
          <InventoryWarnings warnings={warnings} />
          <RecentActivity activity={activity} />
        </div>
      </section>
    </div>
  );
}
