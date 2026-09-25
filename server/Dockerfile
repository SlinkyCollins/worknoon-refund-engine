FROM node:20-alpine

WORKDIR /app

# Install OpenSSL for Prisma query engine and wget/curl for healthchecks
RUN apk add --no-cache openssl libc6-compat wget curl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:seed && npm start"]
