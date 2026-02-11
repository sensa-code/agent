FROM node:22-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

EXPOSE 3000

# Use Next.js dev server with host binding for Docker
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]
