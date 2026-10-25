# Spike (ADR pending): Concat's headless API server on CPU-only Fly Machines.
# Concat is AGPL-3.0-or-later. It is built unmodified from a pinned upstream
# commit and reached only over its token-guarded socket from our Worker; no
# Concat code is linked into this repo. Get legal sign-off before production.
FROM rust:1.93-trixie AS build
ARG CONCAT_REF=2429c0ca6a8bfd296d046d436a31172f618529c1
RUN apt-get update && apt-get install -y --no-install-recommends \
      git cmake clang pkg-config libclang-dev \
      libavcodec-dev libavformat-dev libavutil-dev libswscale-dev \
      libswresample-dev libavfilter-dev libavdevice-dev libasound2-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init . && git remote add origin https://github.com/jub0t/concat \
    && git fetch --depth 1 origin "$CONCAT_REF" && git checkout FETCH_HEAD
WORKDIR /src/src
RUN cargo build --profile app -p concat-cli

FROM debian:trixie-slim
# mesa-vulkan-drivers ships lavapipe, the CPU Vulkan driver wgpu falls back to.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini nodejs ffmpeg mesa-vulkan-drivers libvulkan1 libasound2t64 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -d /work render
COPY --from=build /src/src/target/app/concat-cli /usr/local/bin/concat-cli
COPY smoke.mjs /app/smoke.mjs
USER render
WORKDIR /work
ENV VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json
# CONCAT_API_TOKEN must be set (fly secrets); serve refuses nothing without it
# but would mint a random one nobody can read.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec concat-cli serve --json 0.0.0.0:7420 --root /work"]
