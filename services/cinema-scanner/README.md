# Cinema quarantine scanner

This service claims private Cinema Library videos from migration `0295`, downloads one exact R2 object into the isolated `/quarantine` volume, computes SHA-256 while downloading, verifies its real MIME type and media structure with `file` and `ffprobe`, and asks `clamd` to scan that same path. Only a clean result creates a private Cloudflare Stream upload. The scanner then uploads the same local file it inspected.

`clamd` has no authentication or transport security. Keep port 3310 on the private container network and never publish it. The production image must pin the ClamAV image by digest before deployment. FreshClam must remain enabled so signatures update.

Required scanner secrets are `SUPABASE_SERVICE_ROLE_KEY`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, and `CINEMA_STREAM_API_TOKEN`. The non-secret production
coordinates are checked into `fly.cinema-scanner.toml`. Set
`CINEMA_QUARANTINE_SCANNER_ENABLED=true` only in the scanner container after
migration `0295` is applied. The website flag stays false until the worker is
healthy; turning the website flag on opens only the scanned **From Library**
path. Device uploads remain paused under `CINEMA_PROXY_UPLOADS_ENABLED=false`.

For local infrastructure testing:

```sh
docker compose --profile cinema-scanner up --build clamav cinema-scanner
```

The Compose profile does not publish ClamAV or scanner ports. It uses a private shared volume for one temporary file at a time and persists the signature database separately.
Its checked-in \`clamd.conf\` raises ClamAV's default 100 MiB file ceiling to
the Cinema 2 GiB admission bound and enables \`AlertExceedsMax\`, so any engine
limit produces a flagged verdict instead of a clean result.

Production runs as the private Fly.io app `veyrnox-cinema-scanner` in `ams`.
`services/cinema-scanner/Dockerfile.fly` contains both the pinned official
ClamAV image and the unprivileged Node worker because path scanning requires
both processes to see the exact same `/quarantine` file. The app publishes no
service. Fly checks the private worker health port and ClamAV TCP port.

The first deploy deliberately leaves `CINEMA_QUARANTINE_SCANNER_ENABLED=false`.
Set the four secrets below on the Fly app, verify `/healthz`, then change the
flag to `true` and deploy again:

```sh
fly secrets set -a veyrnox-cinema-scanner \
  SUPABASE_SERVICE_ROLE_KEY=... R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... CINEMA_STREAM_API_TOKEN=...
fly deploy -a veyrnox-cinema-scanner -c fly.cinema-scanner.toml
```

Create dedicated, least-privilege production credentials. The R2 key must read
only `veyrnox-ai-media`; the Stream token must create and upload videos; the
Supabase key is server-only. Never paste these values into source, logs, issue
comments, or command history.
