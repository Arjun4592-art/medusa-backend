FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx medusa build
EXPOSE 9000
CMD ["npx", "medusa", "start"]