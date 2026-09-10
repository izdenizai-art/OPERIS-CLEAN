FROM node:22-alpine AS client-build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build

FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund
COPY server .
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=server-build /app/server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/prisma ./prisma
COPY --from=client-build /app/server/public ./public
EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push && node dist/index.js"]
