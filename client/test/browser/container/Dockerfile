ARG PLAYWRIGHT_VERSION
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble
ARG PLAYWRIGHT_VERSION
WORKDIR /opt/browser
RUN npm install --no-audit --no-fund --ignore-scripts --save-exact playwright@${PLAYWRIGHT_VERSION}
COPY server.mjs ./
CMD ["node", "server.mjs"]
