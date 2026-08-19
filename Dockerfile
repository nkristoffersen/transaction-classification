# Node 24 runs the TypeScript sources directly by stripping types, so there is
# no build step and no compiled artifact to keep in sync with the source.
FROM node:24-alpine

WORKDIR /app

# Dependencies first, so a source edit does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts vitest.eval.config.ts ./
COPY eslint.config.js .prettierrc.json .prettierignore ./
COPY src ./src
COPY ai-engineer/data ./ai-engineer/data
COPY data ./data

CMD ["npm", "start"]
