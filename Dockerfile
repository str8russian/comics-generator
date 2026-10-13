FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libxshmfence1 \
    libx11-xcb1 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app ./app
COPY prototypes ./prototypes
COPY specs ./specs

RUN cd prototypes/remotion-rough && npm ci && npx remotion browser ensure
RUN node app/storyboard-web/write-build-info.mjs

ENV STORYBOARD_PORT=4173
EXPOSE 4173

CMD ["node", "app/storyboard-web/server.mjs"]
