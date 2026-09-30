# TEKRIO website - zero-dependency Node server
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    TEKRIO_DATA_DIR=/data

WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000

# persistent storage: attach a Railway Volume mounted at /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

# rebuild pages first so TEKRIO_GA_ID / TEKRIO_GSC_VERIFICATION apply
CMD ["npm", "start"]
