FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
EXPOSE 6000
CMD ["node", "src/index.js"]
