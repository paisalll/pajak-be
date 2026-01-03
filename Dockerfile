# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
RUN npx prisma migrate deploy

# Stage 2: Run
FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Koyeb butuh expose port (sesuaikan dengan main.ts)
EXPOSE 3000
CMD ["npm", "run", "start:prod"]