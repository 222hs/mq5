# CLAUDE.md — قواعد المشروع

## ⚠️ قواعد PUSH — لا تخالفها أبداً

- **Railway يتابع فرع `main` فقط** — كل push يجب أن يكون على `main`
- الأمر الصحيح دائماً: `git push origin HEAD:main`
- بعد كل commit، ابن الـ frontend (`npm run build` داخل `frontend/`) قبل الرفع

## بناء الـ Frontend

```bash
cd /home/user/mq5/frontend && npm run build
```
الملفات تُبنى تلقائياً في `backend/static/` — يجب commit وpush مع كل تغيير في Dashboard.jsx

## هيكل المشروع

- `agent/fastest_gold.mq5` — بوت الذهب (GSX_ prefix)
- `agent/bitcoin_scalper.mq5` — بوت البتكوين (BSX_ prefix)
- `agent/mt5_agent.py` — Python agent على Windows
- `backend/app.py` — Flask + Railway
- `frontend/src/Dashboard.jsx` — React dashboard (ارفع DASH_VERSION مع كل تغيير)

## ANTHROPIC_API_KEY

مخزنة كـ env var في Railway فقط — لا تُكتب في الكود أبداً.
