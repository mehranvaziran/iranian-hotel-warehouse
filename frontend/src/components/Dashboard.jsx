import React, { useState, useEffect, useRef } from 'react';
import StatCard from './StatCard';
import ActivityPanel from './ActivityPanel';
import InventoryWarnings from './InventoryWarnings';
import RecentActivity from './RecentActivity';
import { toJalaliDisplay } from '../utils/jalali';
import './Dashboard.css';

/**
 * @param {{ onNavigate?: (page: string) => void }} props - lets the dashboard's
 *   "see everything" actions open the module a panel summarises.
 */
export default function Dashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [recentReceipts, setRecentReceipts] = useState([]);
  const [recentIssues, setRecentIssues] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Dashboard search: looks an item up by code or name from here, without having
  // to leave the page first.
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // The poll loop needs the values already on screen without depending on them
  // in the effect's dependency list, which would restart (and re-poll) on every
  // successful fetch. `keep` is mutated in place so the load-once flag survives
  // re-renders.
  const keep = useRef({});
  keep.current.recentReceipts = recentReceipts;
  keep.current.recentIssues = recentIssues;
  keep.current.warnings = warnings;
  keep.current.activity = activity;

  useEffect(() => {
    let cancelled = false;

    const fetchDashboardData = async () => {
      try {
        // Only the first load shows the full-page spinner; a background
        // refresh keeps whatever is already on screen.
        if (!keep.current.hasLoaded) setLoading(true);
        const [statsRes, receiptsRes, issuesRes, warningsRes, activityRes] = await Promise.all([
          fetch('/api/dashboard/stats'),
          fetch('/api/dashboard/recent-receipts'),
          fetch('/api/dashboard/recent-issues'),
          fetch('/api/dashboard/warnings'),
          fetch('/api/dashboard/activity'),
        ]);

        if (!statsRes.ok) throw new Error('خطا در دریافت آمار');

        // Apply the whole batch at once and only after every fetch resolved,
        // so a partial failure cannot leave the panels mutually inconsistent.
        // Panels whose fetch failed keep their previous data.
        const prev = keep.current;
        const next = {
          stats: await statsRes.json(),
          receipts: receiptsRes.ok ? await receiptsRes.json() : prev.recentReceipts,
          issues: issuesRes.ok ? await issuesRes.json() : prev.recentIssues,
          warnings: warningsRes.ok ? await warningsRes.json() : prev.warnings,
          activity: activityRes.ok ? await activityRes.json() : prev.activity,
        };

        if (cancelled) return;

        setStats(next.stats);
        setRecentReceipts(next.receipts);
        setRecentIssues(next.issues);
        setWarnings(next.warnings);
        setActivity(next.activity);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Error fetching dashboard data:', err);
        setError(err.message);
      } finally {
        if (!cancelled) {
          setLoading(false);
          keep.current.hasLoaded = true;
        }
      }
    };

    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000); // Refresh every 30 seconds
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  /**
   * Search the catalog from the dashboard. Debounced: the endpoint is hit once
   * the user pauses, not once per keystroke.
   */
  useEffect(() => {
    const term = searchTerm.trim();
    if (!term) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        setSearching(true);
        // Include retired items: a search for something the warehouse no longer
        // orders should still find the item and the stock it still holds.
        const res = await fetch('/api/items?include_inactive=1');
        if (!res.ok) throw new Error('خطا در جستجو');
        const all = await res.json();
        const q = term.toLowerCase();
        const matches = all
          .filter(
            (i) =>
              String(i.kod_kala ?? '').toLowerCase().includes(q) ||
              String(i.naam_kala ?? '').toLowerCase().includes(q)
          )
          .slice(0, 8);
        if (!cancelled) setSearchResults(matches);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    };

    const handle = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchTerm]);

  const goTo = (page) => {
    if (onNavigate) onNavigate(page);
  };

  if (loading && !stats) {
    return <div className="dashboard-loading">در حال بارگذاری...</div>;
  }

  // Only the first-ever load replaces the page with an error. Once data is on
  // screen, a failed background refresh degrades to a banner instead of
  // wiping the dashboard.
  if (error && !stats) {
    return (
      <div className="dashboard-error">
        <span>خطا: {error}</span>
        <button type="button" className="btn-retry-dashboard" onClick={() => window.location.reload()}>
          تلاش مجدد
        </button>
      </div>
    );
  }

  return (
    <div className="dashboard">
      {error && stats && (
        // Data on screen is stale but still useful; tell the user instead of
        // hiding it, and let them force a reload.
        <div className="dashboard-stale-banner">
          <span>⚠️ به‌روزرسانی ناموفق بود — اطلاعات نمایش داده شده ممکن است قدیمی باشد ({error})</span>
          <button
            type="button"
            className="btn-retry-banner"
            onClick={() => window.location.reload()}
          >
            به‌روزرسانی
          </button>
        </div>
      )}

      {/* Statistics Section */}
      <section className="stats-section">
        <div className="dashboard-search">
          <input
            type="text"
            className="dashboard-search-input"
            placeholder="جستجوی کالا بر اساس نام یا کد..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="جستجوی کالا"
          />
          {searching && <span className="dashboard-search-hint">در حال جستجو...</span>}
          {searchResults.length > 0 && (
            <ul className="dashboard-search-results">
              {searchResults.map((item) => (
                <li key={item.kod_kala}>
                  <button
                    type="button"
                    className="search-result-btn"
                    onClick={() => goTo('items')}
                  >
                    <span className="search-result-code">{item.kod_kala}</span>
                    <span className="search-result-name">{item.naam_kala}</span>
                    <span className="search-result-stock">
                      موجودی: {Number(item.current_stock || 0).toLocaleString('fa-IR')} {item.vahed || ''}
                    </span>
                    {item.is_active === 0 && <span className="search-result-inactive">غیرفعال</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchTerm.trim() && searchResults.length === 0 && !searching && (
            <div className="dashboard-search-empty">کالایی با این نام یا کد یافت نشد</div>
          )}
        </div>

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
              // A `tarikh` is Jalali, but the historical QA rows recorded a
              // Gregorian day; both are shown as Jalali without rewriting the row.
              toJalaliDisplay(r.tarikh),
              `${r.item_count} قلم`,
              `${Number(r.total_quantity || 0).toLocaleString('fa-IR')}`,
            ])}
            columns={['شماره رسید', 'تاریخ', 'تعداد اقلام', 'مقدار کل']}
            onViewAll={onNavigate ? () => goTo('receipts') : undefined}
          />

          <ActivityPanel
            title="آخرین خروج‌ها"
            rows={recentIssues.map(i => [
              i.issue_number,
              toJalaliDisplay(i.tarikh),
              `${i.item_count} قلم`,
              `${Number(i.total_quantity || 0).toLocaleString('fa-IR')}`,
              i.tahvil_gir || '-',
            ])}
            columns={['شماره حواله', 'تاریخ', 'تعداد اقلام', 'مقدار کل', 'تحویل‌گیرنده']}
            onViewAll={onNavigate ? () => goTo('issues') : undefined}
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
