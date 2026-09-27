# syntax=docker/dockerfile:1

# Install production dependencies only. No package has an install script, so none are run.
FROM node:24-trixie-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:24-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Secrets (DISCORD_TOKEN, ...) come from the environment and config.json is mounted at
# /app/config.json at runtime; neither is ever part of the image.
USER node

# Run node directly rather than `npm start` so SIGTERM reaches the bot's shutdown handler.
CMD ["node", "src/index.js"]
