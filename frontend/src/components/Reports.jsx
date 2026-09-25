import React, { useState, useEffect } from 'react';
import './Reports.css';

export default function Reports() {
  const [items, setItems] = useState([]);
  const [activeTab, setActiveTab] = useState('inventory');

  // Inventory report state
  const [invGroup, setInvGroup] = useState('all');
  const [invData, setInvData] = useState(null);
  const [invLoading, setInvLoading] = useState(false);

  // Cardex state
  const [cardexItem, setCardexItem] = useState('');
  const [cardexData, setCardexData] = useState(null);
  const [cardexLoading, setCardexLoading] = useState(false);

  // Movements state
  const [movFrom, setMovFrom] = useState('');
  const [movTo, setMovTo] = useState('');
  const [movItem, setMovItem] = useState('');
  const [movData, setMovData] = useState(null);
  const [movLoading, setMovLoading] = useState(false);

  // Receipts / issues report state
  const [docFrom, setDocFrom] = useState('');
  const [docTo, setDocTo] = useState('');
  const [receiptsData, setReceiptsData] = useState(null);
  const [issuesData, setIssuesData] = useState(null);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    fetch('/api/items')
      .then(res => res.ok ? res.json() : [])
      .then(data => setItems(data))
      .catch(() => setItems([]));
  }, []);

  const groups = ['all', ...new Set(items.map(item => item.goh).filter(Boolean))];

  const runInventoryReport = async () => {
    try {
      setInvLoading(true);
      const res = await fetch(`/api/reports/inventory${invGroup !== 'all' ? `?group=${encodeURIComponent(invGroup)}` : ''}`);
      if (!res.ok) throw new Error('خطا در دریافت گزارش');
      setInvData(await res.json());
    } catch (err) {
      alert(err.message);
    } finally {
      setInvLoading(false);
    }
  };

  const runCardex = async () => {
    if (!cardexItem) {
      alert('کالا را انتخاب کنید');
      return;
    }
    try {
      setCardexLoading(true);
      const res = await fetch(`/api/items/${encodeURIComponent(cardexItem)}/cardex`);
      if (!res.ok) throw new Error('خطا در دریافت کارتکس');
      setCardexData(await res.json());
    } catch (err) {
      alert(err.message);
    } finally {
      setCardexLoading(false);
    }
  };

  const runMovements = async () => {
    const params = new URLSearchParams();
    if (movFrom) params.set('from', movFrom);
    if (movTo) params.set('to', movTo);
    if (movItem) params.set('kala_id', movItem);
    try {
      setMovLoading(true);
      const res = await fetch(`/api/reports/movements?${params.toString()}`);
      if (!res.ok) throw new Error('خطا در دریافت گزارش حرکات');
      setMovData(await res.json());
    } catch (err) {
      alert(err.message);
    } finally {
      setMovLoading(false);
    }
  };

  const runDocReports = async () => {
    const params = new URLSearchParams();
    if (docFrom) params.set('from', docFrom);
    if (docTo) params.set('to', docTo);
    const qs = params.toString();
    try {
      setDocLoading(true);
      const [rRes, iRes] = await Promise.all([
        fetch(`/api/reports/receipts${qs ? `?${qs}` : ''}`),
        fetch(`/api/reports/issues${qs ? `?${qs}` : ''}`),
      ]);
      if (rRes.ok) setReceiptsData(await rRes.json());
      if (iRes.ok) setIssuesData(await iRes.json());
    } catch (err) {
      alert(err.message);
    } finally {
      setDocLoading(false);
    }
  };

  const tabs = [
    { id: 'inventory', label: 'گزارش موجودی', icon: '📋' },
    { id: 'cardex', label: 'کارتکس کالا', icon: '📊' },
    { id: 'movements', label: 'حرکات انبار', icon: '🔄' },
    { id: 'documents', label: 'ورود و خروج', icon: '📥' },
  ];

  return (
    <div className="reports-container">
      <div className="reports-header">
        <h1>گزارشات و چاپ</h1>
        <div className="header-buttons">
          <button
            className="btn-print-all"
            onClick={() => window.open(`/api/print/inventory${invGroup !== 'all' ? `?group=${encodeURIComponent(invGroup)}` : ''}`, '_blank')}
          >
            🖨️ چاپ گزارش موجودی
          </button>
        </div>
      </div>

      <div className="reports-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`report-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Inventory report */}
      {activeTab === 'inventory' && (
        <div className="report-section">
          <div className="report-filters">
            <label>
              گروه کالا:
              <select value={invGroup} onChange={(e) => setInvGroup(e.target.value)}>
                {groups.map(g => (
                  <option key={g} value={g}>{g === 'all' ? 'همه گروه‌ها' : g}</option>
                ))}
              </select>
            </label>
            <button className="btn-run" onClick={runInventoryReport}>مشاهده گزارش</button>
          </div>

          {invLoading && <div className="loading">در حال بارگذاری...</div>}

          {invData && !invLoading && (
            <>
              <div className="report-summary">
                <div className="summary-chip"><span>تاریخ گزارش:</span><strong>{invData.reportDate}</strong></div>
                <div className="summary-chip"><span>گروه:</span><strong>{invData.group}</strong></div>
                <div className="summary-chip"><span>تعداد کالاها:</span><strong>{Number(invData.items.length).toLocaleString('fa-IR')}</strong></div>
                <div className="summary-chip"><span>جمع موجودی فعلی:</span><strong>{Number(invData.totals.current).toLocaleString('fa-IR')}</strong></div>
              </div>

              <div className="report-table-container">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>ردیف</th><th>کد کالا</th><th>نام کالا</th><th>گروه</th>
                      <th>مبنا</th><th>ورود</th><th>خروج</th><th>موجودی فعلی</th>
                      <th>حداقل</th><th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invData.items.map((item, idx) => (
                      <tr key={item.kod_kala}>
                        <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                        <td className="kod-kala">{item.kod_kala}</td>
                        <td className="naam-kala">{item.naam_kala}</td>
                        <td>{item.goh || '-'}</td>
                        <td>{Number(item.baseline_qty).toLocaleString('fa-IR')}</td>
                        <td>{Number(item.total_receipts).toLocaleString('fa-IR')}</td>
                        <td>{Number(item.total_issues).toLocaleString('fa-IR')}</td>
                        <td className="mojoodi">{Number(item.current_stock).toLocaleString('fa-IR')}</td>
                        <td>{Number(item.hadd_aqal_mojoodi).toLocaleString('fa-IR')}</td>
                        <td>{item.status}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4}>جمع کل</td>
                      <td>{Number(invData.totals.baseline).toLocaleString('fa-IR')}</td>
                      <td>{Number(invData.totals.receipts).toLocaleString('fa-IR')}</td>
                      <td>{Number(invData.totals.issues).toLocaleString('fa-IR')}</td>
                      <td>{Number(invData.totals.current).toLocaleString('fa-IR')}</td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {invData.items.length === 0 && <div className="empty-state">داده‌ای برای این گروه وجود ندارد</div>}
            </>
          )}
        </div>
      )}

      {/* Cardex */}
      {activeTab === 'cardex' && (
        <div className="report-section">
          <div className="report-filters">
            <label>
              کالا:
              <select value={cardexItem} onChange={(e) => setCardexItem(e.target.value)}>
                <option value="">انتخاب کالا</option>
                {items.map(item => (
                  <option key={item.kod_kala} value={item.kod_kala}>
                    {item.kod_kala} - {item.naam_kala}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-run" onClick={runCardex}>مشاهده کارتکس</button>
            {cardexItem && (
              <button
                className="btn-print-inline"
                onClick={() => window.open(`/api/print/cardex/${encodeURIComponent(cardexItem)}`, '_blank')}
              >
                🖨️ چاپ کارتکس
              </button>
            )}
          </div>

          {cardexLoading && <div className="loading">در حال بارگذاری...</div>}

          {cardexData && !cardexLoading && (
            cardexData.length > 0 ? (
              <div className="report-table-container">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>ردیف</th><th>نوع حرکت</th><th>تاریخ</th><th>شماره سند</th>
                      <th>ورود</th><th>خروج</th><th>مانده</th><th>توضیحات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cardexData.map((row, idx) => (
                      <tr key={idx}>
                        <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                        <td>{row.type === 'baseline' ? 'موجودی مبنا' : row.type === 'receipt' ? 'ورود' : 'خروج'}</td>
                        <td>{row.date || '-'}</td>
                        <td>{row.doc_num || '-'}</td>
                        <td className="qty-in">{row.receipt_qty ? Number(row.receipt_qty).toLocaleString('fa-IR') : '-'}</td>
                        <td className="qty-out">{row.issue_qty ? Number(row.issue_qty).toLocaleString('fa-IR') : '-'}</td>
                        <td className="qty-balance">{Number(row.balance).toLocaleString('fa-IR')}</td>
                        <td>{row.note || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">حرکتی برای این کالا ثبت نشده است</div>
            )
          )}
        </div>
      )}

      {/* Movements */}
      {activeTab === 'movements' && (
        <div className="report-section">
          <div className="report-filters">
            <label>
              از تاریخ:
              <input type="date" value={movFrom} onChange={(e) => setMovFrom(e.target.value)} />
            </label>
            <label>
              تا تاریخ:
              <input type="date" value={movTo} onChange={(e) => setMovTo(e.target.value)} />
            </label>
            <label>
              کالا:
              <select value={movItem} onChange={(e) => setMovItem(e.target.value)}>
                <option value="">همه کالاها</option>
                {items.map(item => (
                  <option key={item.kod_kala} value={item.kod_kala}>
                    {item.kod_kala} - {item.naam_kala}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-run" onClick={runMovements}>مشاهده حرکات</button>
          </div>

          {movLoading && <div className="loading">در حال بارگذاری...</div>}

          {movData && !movLoading && (
            movData.count > 0 ? (
              <div className="report-table-container">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>ردیف</th><th>تاریخ</th><th>نوع</th><th>شماره سند</th>
                      <th>کد کالا</th><th>نام کالا</th><th>مقدار</th><th>طرف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movData.movements.map((m, idx) => (
                      <tr key={idx}>
                        <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                        <td>{m.tarikh || '-'}</td>
                        <td>{m.kind === 'baseline' ? 'موجودی مبنا' : m.kind === 'receipt' ? 'ورود' : 'خروج'}</td>
                        <td>{m.doc_number || '-'}</td>
                        <td className="kod-kala">{m.kala_id}</td>
                        <td>{m.naam_kala || '-'}</td>
                        <td className={m.direction > 0 ? 'qty-in' : 'qty-out'}>
                          {m.direction > 0 ? '+' : '-'}{Number(m.qty).toLocaleString('fa-IR')}
                        </td>
                        <td>{m.party || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">حرکتی در این بازه ثبت نشده است</div>
            )
          )}
        </div>
      )}

      {/* Receipts & issues */}
      {activeTab === 'documents' && (
        <div className="report-section">
          <div className="report-filters">
            <label>
              از تاریخ:
              <input type="date" value={docFrom} onChange={(e) => setDocFrom(e.target.value)} />
            </label>
            <label>
              تا تاریخ:
              <input type="date" value={docTo} onChange={(e) => setDocTo(e.target.value)} />
            </label>
            <button className="btn-run" onClick={runDocReports}>مشاهده اسناد</button>
          </div>

          {docLoading && <div className="loading">در حال بارگذاری...</div>}

          {receiptsData && !docLoading && (
            <>
              <h3 className="subsection-title">
                رسیدهای ورود ({Number(receiptsData.count).toLocaleString('fa-IR')} سند - مجموع {Number(receiptsData.total_quantity).toLocaleString('fa-IR')} واحد)
              </h3>
              {receiptsData.count > 0 ? (
                <div className="report-table-container">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>ردیف</th><th>شماره رسید</th><th>تاریخ</th><th>تعداد اقلام</th><th>مقدار کل</th><th>چاپ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receiptsData.receipts.map((r, idx) => (
                        <tr key={r.id}>
                          <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                          <td className="doc-num">{r.receipt_number}</td>
                          <td>{r.tarikh}</td>
                          <td>{Number(r.lines.length).toLocaleString('fa-IR')}</td>
                          <td>{Number(r.lines.reduce((s, l) => s + Number(l.maqdar || 0), 0)).toLocaleString('fa-IR')}</td>
                          <td>
                            <button
                              className="btn-print-row"
                              onClick={() => window.open(`/api/print/receipt/${r.id}`, '_blank')}
                            >
                              🖨️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">رسیدی در این بازه ثبت نشده است</div>
              )}
            </>
          )}

          {issuesData && !docLoading && (
            <>
              <h3 className="subsection-title">
                حواله‌های خروج ({Number(issuesData.count).toLocaleString('fa-IR')} سند - مجموع {Number(issuesData.total_quantity).toLocaleString('fa-IR')} واحد)
              </h3>
              {issuesData.count > 0 ? (
                <div className="report-table-container">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>ردیف</th><th>شماره حواله</th><th>تاریخ</th><th>تحویل‌گیرنده</th>
                        <th>تعداد اقلام</th><th>مقدار کل</th><th>چاپ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {issuesData.issues.map((i, idx) => (
                        <tr key={i.id}>
                          <td>{(idx + 1).toLocaleString('fa-IR')}</td>
                          <td className="doc-num">{i.issue_number}</td>
                          <td>{i.tarikh}</td>
                          <td>{i.tahvil_gir || '-'}</td>
                          <td>{Number(i.lines.length).toLocaleString('fa-IR')}</td>
                          <td>{Number(i.lines.reduce((s, l) => s + Number(l.maqdar || 0), 0)).toLocaleString('fa-IR')}</td>
                          <td>
                            <button
                              className="btn-print-row"
                              onClick={() => window.open(`/api/print/issue/${i.id}`, '_blank')}
                            >
                              🖨️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">حواله‌ای در این بازه ثبت نشده است</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
