FROM node:24-bookworm

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 8787

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
