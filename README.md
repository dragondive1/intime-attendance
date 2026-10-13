# نظام حضور الهايبر ماركت 🏪

نظام متكامل لتسجيل حضور وانصراف موظفي الهايبر ماركت مع تحقق من الموقع الجغرافي.

## المتطلبات

- [Node.js](https://nodejs.org/) الإصدار 18 أو أحدث
- npm

## التثبيت والتشغيل

### 1. تثبيت المكتبات

```bash
npm install
```

### 2. إعداد متغيرات البيئة

الملف `.env` موجود مسبقاً بالقيم الافتراضية. يمكنك تعديله:

```env
JWT_SECRET=hypermarket_secret_2024
PORT=3000
```

### 3. تشغيل الخادم

```bash
# تشغيل عادي
npm start

# تشغيل مع إعادة تحميل تلقائي (للتطوير)
npm run dev
```

### 4. فتح التطبيق

افتح المتصفح على العنوان:
```
http://localhost:3000
```

---

## بيانات الدخول الافتراضية

### المدير
| الحقل | القيمة |
|-------|--------|
| اسم المستخدم | `admin` |
| كلمة المرور | `admin123` |

### العمال
| اسم المستخدم | كلمة المرور |
|--------------|------------|
| `worker1` | `123456` |
| `worker2` | `123456` |
| `worker3` | `123456` |

---

## هيكل المشروع

```
intime/
├── server.js              # نقطة دخول الخادم
├── package.json
├── .env                   # متغيرات البيئة
├── .env.example
├── database/
│   ├── db.js              # إعداد قاعدة البيانات SQLite
│   └── attendance.db      # قاعدة البيانات (تُنشأ تلقائياً)
├── routes/
│   ├── auth.js            # مسارات المصادقة
│   ├── admin.js           # مسارات لوحة الأدمن
│   └── worker.js          # مسارات لوحة العامل
├── middleware/
│   ├── auth.js            # التحقق من JWT
│   └── geofence.js        # التحقق من الموقع الجغرافي
└── public/
    ├── index.html         # صفحة تسجيل الدخول
    ├── admin/
    │   └── index.html     # لوحة تحكم الأدمن
    └── worker/
        └── index.html     # لوحة العامل
```

---

## الميزات

### لوحة الأدمن
- 📊 إحصائيات يومية وشهرية
- 👷 إدارة العمال (إضافة، تعديل، حذف)
- 📋 تقارير الحضور مع فلاتر متعددة
- 📍 إدارة نطاقات الموقع الجغرافي
- 📤 تصدير البيانات بصيغة JSON
- ✏️ تسجيل غياب تلقائي

### لوحة العامل
- ✅ تسجيل حضور وانصراف بنقرة واحدة
- 📍 تحقق تلقائي من الموقع الجغرافي (Geofence)
- 📅 عرض سجل آخر 30 يوم
- 📊 إحصائيات الشهر الحالي

---

## API Endpoints

### المصادقة
- `POST /api/auth/login` - تسجيل الدخول
- `GET /api/auth/me` - بيانات المستخدم الحالي

### الأدمن (يتطلب صلاحية admin)
- `GET /api/admin/workers` - قائمة العمال
- `POST /api/admin/workers` - إضافة عامل
- `PUT /api/admin/workers/:id` - تعديل عامل
- `DELETE /api/admin/workers/:id` - حذف عامل
- `GET /api/admin/attendance` - سجلات الحضور
- `GET /api/admin/stats` - الإحصائيات
- `GET /api/admin/locations` - المواقع الجغرافية
- `POST /api/admin/locations` - إضافة موقع
- `PUT /api/admin/locations/:id` - تعديل موقع
- `DELETE /api/admin/locations/:id` - حذف موقع
- `POST /api/admin/attendance/mark-absent` - تسجيل غياب
- `GET /api/admin/export/monthly/:year/:month` - تصدير شهري

### العامل (يتطلب صلاحية worker)
- `GET /api/worker/status` - حالة اليوم
- `POST /api/worker/checkin` - تسجيل حضور
- `POST /api/worker/checkout` - تسجيل انصراف
- `GET /api/worker/history` - سجل الحضور
- `GET /api/worker/stats` - الإحصائيات الشخصية

---

## التقنيات المستخدمة

- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **Auth**: JWT (jsonwebtoken)
- **Password**: bcryptjs
- **Frontend**: Vanilla HTML/CSS/JS + Tailwind CSS
- **Font**: Cairo (Google Fonts)

---

> جميع الحقوق محفوظة © 2024
