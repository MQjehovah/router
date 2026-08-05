FROM node:18-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx scripts/init-admin.js && npx tsx src/index.ts"]
