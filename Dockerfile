FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app ./app
COPY prototypes ./prototypes
COPY specs ./specs

ENV STORYBOARD_PORT=4173
EXPOSE 4173

CMD ["node", "app/storyboard-web/server.mjs"]
