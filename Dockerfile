# OpenPearl runtime image: extension host (default), intake service, migrations and deploy CLI.
# Works with Docker and Podman (Containerfile is a symlink to this file).
#
#   docker build -t openpearl .        podman build -t openpearl .
#   docker compose up                  podman compose up    (see compose.yaml)
FROM docker.io/library/node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Only the runtime dependency (pg); no lifecycle scripts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY framework/ framework/
COPY isolation/ isolation/
COPY deploy/ deploy/
COPY intake/ intake/

# Unprivileged user; the registry is mounted read-only into the host
RUN mkdir -p /registry && chown node:node /registry
USER node
ENV OPENPEARL_REGISTRY_DIR=/registry PORT=8788
EXPOSE 8788 8787

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "framework/serve.js"]
