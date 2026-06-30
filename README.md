# MT5 Dashboard — دليل التشغيل الكامل

نظام مراقبة بوت MT5 أونلاين، نفس فكرة داشبورد Binance.

## المكونات

```
agent/    → يشتغل على جهاز Windows (يقرأ MT5 ويرسل البيانات)
backend/  → Flask API (ينشر على Railway)
frontend/ → React Dashboard (ينشر على Railway)
```

---

## الخطوة 1 — نشر الـ Backend على Railway

1. افتح [railway.app](https://railway.app) وسجل دخول
2. New Project → Deploy from GitHub repo (ارفع مجلد `backend` لمستودع GitHub أولاً)
   - أو استخدم Railway CLI: `railway up` من داخل مجلد backend
3. بعد النشر، روح Settings → Variables وأضف:
   ```
   API_KEY = اختر-مفتاح-سري-قوي-هنا
   ```
4. انسخ الرابط اللي يعطيك ياه Railway (مثل `https://mt5-backend-production.up.railway.app`)

---

## الخطوة 2 — تجهيز الـ Agent على Windows

على جهاز Windows اللي عليه MT5:

```bash
pip install MetaTrader5 requests
```

افتح ملف `agent/mt5_agent.py` وعدّل:
```python
BACKEND_URL = "https://رابط-الباك-اند-من-railway/api/update"
API_KEY = "نفس-المفتاح-اللي-حطيته-في-railway"
```

شغّله:
```bash
python mt5_agent.py
```

**مهم:** خلّي MT5 مفتوح ومسجل دخول قبل ما تشغّل الـ Agent.

للتشغيل الدائم 24/7، تحتاج الجهاز يكون شغال دايماً (أو VPS Windows).

---

## الخطوة 3 — نشر الـ Frontend على Railway

1. أنشئ مشروع React جديد محلياً (Vite):
   ```bash
   npm create vite@latest mt5-frontend -- --template react
   cd mt5-frontend
   ```
2. انسخ `Dashboard.jsx` إلى `src/`
3. عدّل `src/App.jsx` ليستورد ويعرض `Dashboard`:
   ```jsx
   import Dashboard from "./Dashboard";
   export default function App() {
     return <Dashboard />;
   }
   ```
4. أنشئ ملف `.env`:
   ```
   VITE_API_URL=https://رابط-الباك-اند-من-railway
   ```
5. ارفعه لـ GitHub وانشره على Railway (نفس خطوات الـ Backend)

---

## الفحص

افتح رابط الـ Frontend من المتصفح — المفروض تشوف:
- نقطة خضراء "البوت متصل" إذا الـ Agent شغال ويرسل بيانات
- الرصيد والإكويتي تتحدث كل 5 ثواني
- الصفقات المفتوحة وآخر الصفقات

---

## ملاحظات أمان

- لا تشارك `API_KEY` مع أحد
- الـ Backend يرفض أي طلب بدون المفتاح الصحيح
- بياناتك (رصيدك، صفقاتك) تُخزن فقط على سيرفر Railway الخاص فيك
