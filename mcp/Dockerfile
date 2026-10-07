# The hosted MCP server (garmin.ficdev.xyz/mcp). Build from the REPO ROOT — the server inlines the
# library's ../src at build time:  docker build -f mcp/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY mcp/package.json mcp/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build -w mcp

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/mcp/dist-http/http.mjs ./http.mjs
# A named volume copies this ownership on first use; a bind mount must be writable by uid 1000.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/mcp/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "http.mjs"]
