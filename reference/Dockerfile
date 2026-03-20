# Build client + install deps
FROM node:22-bookworm AS build
WORKDIR /app

# Keep Playwright browsers outside node_modules so we can copy between stages.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json

RUN npm ci

# Install Chromium for Playwright (required for Discord automation).
RUN npx playwright install chromium

COPY . .
RUN npm run build -w client

# Remove dev dependencies for smaller runtime image
RUN npm prune --omit=dev

# Runtime
FROM node:22-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# SEC asks for a descriptive User-Agent with contact info when accessing data.sec.gov.
# Override at runtime with `-e SEC_USER_AGENT=...` if desired.
ENV SEC_USER_AGENT="marketmind (Private; Laurent@hotmail.co.za)"

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=build /ms-playwright /ms-playwright

COPY --from=build /app /app

# Install system dependencies for the Playwright browsers.
RUN npx playwright install-deps chromium

EXPOSE 3000
CMD ["node", "server/index.js"]
