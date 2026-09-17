FROM node:24.17.0-bookworm-slim@sha256:862263c612aa437e3037674b85419622a9d93bff80aa1eee5398dfe686375532

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /workspaces/parallel-agents/node_modules /workspaces/parallel-agents/out /workspaces/parallel-agents/reports \
    && chown -R node:node /workspaces/parallel-agents

WORKDIR /workspaces/parallel-agents
USER node
