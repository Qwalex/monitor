FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
# bybit-api тянет optional webpack/ts-loader — без полного дерева в lock `npm ci` падает; рантайму они не нужны
RUN npm ci --omit=optional

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/src/ui ./src/ui

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]