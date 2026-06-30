FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json .
RUN npm install
COPY frontend/ .
RUN npm run build

FROM python:3.11-slim
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
COPY --from=frontend-build /app/backend/static ./static

EXPOSE 8000
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "app:app"]
