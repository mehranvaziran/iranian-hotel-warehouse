# پروژه توسعه هتل ایرانیان - سامانه هوشمند مدیریت انبار

## معرفی
سامانه مدیریت انبار توسعه هتل ایرانیان با فناوری‌های مدرن و واسط کاربری حرفه‌ای.

### تکنولوژی‌ها
- **Frontend**: React + Vite
- **Backend**: Node.js + Express
- **Database**: SQLite
- **UI**: Persian RTL, Custom CSS

## راه‌اندازی

### پیش‌نیازها
- Node.js v18+
- npm 9+

### نصب و اجرا

#### 1. نصب وابستگی‌های Backend
```bash
cd backend
npm install
```

#### 2. نصب وابستگی‌های Frontend
```bash
cd frontend
npm install
```

#### 3. اجرای Backend
```bash
cd backend
npm start
```
سرور backend در `http://localhost:3000` شروع می‌شود.

#### 4. اجرای Frontend (در ترمینال جدید)
```bash
cd frontend
npm run dev
```
سرور frontend در `http://localhost:5173` شروع می‌شود.

### دسترسی
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api

## ساختار پروژه
```
.
├── backend/
│   ├── src/
│   │   ├── server.js          # Express server
│   │   └── db.js              # Database initialization
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── data/
│   └── warehouse.db           # SQLite database (auto-created)
├── سیستم انبار.xlsx          # Excel reference file
└── README.md
```

## فایل‌های اصلی

### Backend
- `src/server.js`: Express server و API endpoints
- `src/db.js`: SQLite database setup و sample data

### Frontend
- `src/App.jsx`: Layout اصلی
- `src/components/Sidebar.jsx`: منوی کناری
- `src/components/Header.jsx`: Header سامانه
- `src/components/Dashboard.jsx`: Dashboard اصلی
- `src/components/StatCard.jsx`: کارت آمار
- `src/components/ActivityPanel.jsx`: پنل فعالیت‌ها
- `src/components/InventoryWarnings.jsx`: هشدار موجودی
- `src/components/RecentActivity.jsx`: تاریخچه فعالیت‌ها

## رنگ‌های تم
- رنگ اصلی: #E45826 (آجر/نارنجی ایرانیان)
- پس‌زمینه: #1a1a1a (نزدیک سیاه)
- متن: #f5f5f5 (سفید/خاکستری)

## API Endpoints

### Dashboard
- `GET /api/dashboard/stats` - آمار کلی
- `GET /api/dashboard/recent-receipts` - آخرین ورودها
- `GET /api/dashboard/recent-issues` - آخرین خروج‌ها
- `GET /api/dashboard/warnings` - هشدار موجودی
- `GET /api/dashboard/activity` - آخرین فعالیت‌ها

## یادداشت‌های مهم
- فایل اکسل اصلی (`سیستم انبار.xlsx`) فقط به عنوان reference استفاده می‌شود و تغییر نمی‌خورد
- تمام داده‌ها در SQLite database ذخیره می‌شوند
- Dashboard هر ۳۰ ثانیه به طور خودکار به‌روزرسانی می‌شود

## نسخه
v1.0.0

## توسعه‌دهندگان
تیم توسعه پروژه هتل ایرانیان
