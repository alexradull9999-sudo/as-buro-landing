FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server/*.mjs ./
WORKDIR /app
COPY *.html *.css *.js *.mjs ./
COPY assets/ ./assets/
COPY downloads/ ./downloads/
USER node
EXPOSE 8080
CMD ["node", "server/server.mjs"]
