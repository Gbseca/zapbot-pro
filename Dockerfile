FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci \
  && npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
