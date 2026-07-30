# DiziRx

Enterprise-style split repo layout:

- `backend/`: NestJS API (MongoDB via Mongoose)
- `frontend/`: React (Vite) internal web app

## Local development

### 1) Start infrastructure (MongoDB + Redis)

```bash
cd /mnt/Dev/Vidhema/DiziRx
docker compose up -d
```

If Docker daemon isn’t running, start Docker first.

### 2) Backend

```bash
cd /mnt/Dev/Vidhema/DiziRx/backend
cp .env.example .env
pnpm install
pnpm start:dev
```

Health check:

```bash
curl http://localhost:4000/health
```

### 3) Frontend

```bash
cd /mnt/Dev/Vidhema/DiziRx/frontend
cp .env.example .env
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

