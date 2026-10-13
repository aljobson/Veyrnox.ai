FROM node:22-alpine

RUN apk add --no-cache file ffmpeg tini \
    && addgroup -S scanner \
    && adduser -S -G scanner -h /app scanner \
    && mkdir -p /app /quarantine \
    && chown scanner:scanner /app /quarantine

WORKDIR /app
COPY --chown=scanner:scanner services/cinema-scanner ./services/cinema-scanner
COPY --chown=scanner:scanner lib ./lib
COPY --chown=scanner:scanner packages/adapters ./packages/adapters
COPY --chown=scanner:scanner packages/db/supabase-client.js ./packages/db/supabase-client.js

USER scanner
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "services/cinema-scanner/worker.mjs"]
