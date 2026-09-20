FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package*.json ./
RUN npm ci --no-audit --no-fund

# Build sub-packages
FROM deps AS builder
COPY . .
RUN npm run build
# Runtime image gets production deps only.
RUN npm prune --omit=dev

# Production runner: unprivileged user, prod deps only.
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node

EXPOSE 3000
CMD ["npm", "start"]
