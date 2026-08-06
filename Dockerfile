FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/

RUN npm install

COPY . .

RUN cd apps/backend && npx medusa build

WORKDIR /app/apps/backend

EXPOSE 9000

CMD ["npx", "medusa", "start"]