FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.147.0

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      gh \
      git \
      jq \
      openssh-client \
      python3 \
      python3-pip \
      python3-venv \
      ripgrep \
      util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global "@openai/codex@${CODEX_VERSION}" \
    && git config --system credential.https://github.com.helper "!gh auth git-credential" \
    && git config --system credential.https://gist.github.com.helper "!gh auth git-credential" \
    && mkdir -p /home/relay/.codex /workspace

COPY entrypoint.sh /usr/local/bin/relay-container-entrypoint

RUN chmod 0755 /usr/local/bin/relay-container-entrypoint

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/relay-container-entrypoint"]
