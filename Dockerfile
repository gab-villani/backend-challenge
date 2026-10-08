FROM oven/bun:1-alpine AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/mikro-orm.config.ts ./

EXPOSE 3000

CMD ["bun", "dist/main.js"]
