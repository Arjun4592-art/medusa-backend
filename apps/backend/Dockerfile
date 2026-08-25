FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npx medusa build
EXPOSE 9000
CMD ["npx", "medusa", "start"]