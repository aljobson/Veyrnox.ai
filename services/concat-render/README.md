# concat-render (spike)

Headless [Concat](https://github.com/jub0t/concat) (AGPL-3.0) as a render
service. Unmodified upstream, pinned by commit in the Dockerfile, reached only
over its token-guarded JSON-RPC socket. Nothing in the Worker or mobile app
calls it yet; there is no flag because there is no code path to gate.

Questions this answers: does Concat render with no GPU (lavapipe), how fast,
and does its `concat.json` suit our timeline.

Run (builds Rust + FFmpeg bindings: ~10-20 min, ~6 GB):

    docker build -f services/concat-render/Dockerfile -t concat-render services/concat-render
    docker run --rm -d --name cr -e CONCAT_API_TOKEN=local-test concat-render
    docker exec -e CONCAT_API_TOKEN=local-test cr node /app/smoke.mjs 640 360
    docker exec -e CONCAT_API_TOKEN=local-test cr node /app/smoke.mjs
    docker rm -f cr

Prints `realtimeFactor` (render seconds per clip second). The Fly numbers are
the ones that count; local Docker on Apple silicon runs arm64.
