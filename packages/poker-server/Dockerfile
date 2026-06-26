FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/poker-engine ./packages/poker-engine
COPY packages/poker-server ./packages/poker-server

RUN pnpm install --frozen-lockfile
CMD ["node", "--import", "tsx/esm", "packages/poker-server/src/index.ts"]
