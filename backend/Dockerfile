FROM node:26-alpine AS deps
WORKDIR /app
# Don't let Puppeteer download its own Chrome during install — on Alpine
# (musl libc) that binary can't run anyway; we use the system Chromium.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

FROM node:26-alpine AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Headless Chromium + the shared libs/fonts it needs to run on Alpine.
# Puppeteer launches this binary (see PUPPETEER_EXECUTABLE_PATH) to render
# the prescription share page into a PDF.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

COPY --from=build /app/dist ./dist
# Runtime needs node_modules (NestJS + Puppeteer) — the previous image
# omitted this, so `node dist/main.js` couldn't start.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 4000
CMD ["node", "dist/main.js"]
