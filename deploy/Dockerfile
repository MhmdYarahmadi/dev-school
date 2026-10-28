# pgschool: the static site + the zero-dependency API server, in one small container.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data STATIC_DIR=/app/dist NODE_NO_WARNINGS=1
COPY server ./server
COPY dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/api/health || exit 1
CMD ["node", "server/index.mjs"]
