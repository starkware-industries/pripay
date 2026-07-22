# PriPay server: serves the built SPA (pripay/) + the /api Firestore store.
# node_modules is vendored in-repo and copied as-is — we do NOT run npm install
# (the private starknet SDK makes fresh installs fragile). Node 18+ for global fetch.
FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY node_modules ./node_modules
COPY firestore-rest.js pripay-sign.js server.js ./
COPY pripay ./pripay

ENV NODE_ENV=production
# Cloud Run injects PORT; server.js reads process.env.PORT.
CMD ["node", "server.js"]
