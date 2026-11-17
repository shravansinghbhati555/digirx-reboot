# syntax=docker/dockerfile:1.6
#
# Static-site build for the React/Vite app. Stage 1 produces the bundle;
# stage 2 serves it with nginx + the security/HSTS headers from
# nginx.conf. The bundle is hashed-asset only — no runtime config — so
# `VITE_API_BASE_URL` is baked at build time.

# ---- stage 1: build ---------------------------------------------------------
FROM node:26-alpine AS build

ENV PNPM_VERSION=10.33.2
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig*.json vite.config.* postcss.config.* tailwind.config.* index.html ./
COPY src ./src
COPY public ./public

# VITE_API_BASE_URL gets baked into the bundle. Override at build time:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com .
ARG VITE_API_BASE_URL=https://api.digirx.stageprojects.xyz/
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN pnpm build


# ---- stage 2: nginx ---------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Drop the stock default config; ours sets up SPA fallback, gzip, and
# security headers including HSTS.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# nginx alpine already runs as `nginx` for worker processes; the master
# process needs root to bind :80. `start-period` accommodates the brief
# init while nginx loads its config.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost/ || exit 1

EXPOSE 80
