FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package*.json ./
COPY packages/Vibe-Workflow/packages/workflow-builder/package*.json ./packages/Vibe-Workflow/packages/workflow-builder/
COPY packages/Open-Poe-AI/packages/agents/package*.json ./packages/Open-Poe-AI/packages/agents/
COPY packages/studio/package*.json ./packages/studio/
RUN npm ci --no-audit --no-fund

# Build sub-packages
FROM deps AS builder
COPY . .
RUN npm run build:packages
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
