FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx medusa build
WORKDIR /app/.medusa/server
RUN npm install --legacy-peer-deps --omit=dev
EXPOSE 9000
CMD ["npx", "medusa", "start"]