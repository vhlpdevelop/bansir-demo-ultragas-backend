# Multi-stage Dockerfile for Bansir SaaS Node.js API
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Native Node dependencies and NFeWizard's transitive xsd-schema-validator.
# Its postinstall compiles a Java helper even when runtime validation uses JS.
RUN apk add --no-cache python3 make g++ openjdk17-jdk
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk

COPY package*.json ./
RUN javac -version && npm ci --omit=dev

COPY . .

# Production runner
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Garante biblioteca de runtime C++ para módulos nativos
RUN apk add --no-cache libstdc++

ENV NODE_ENV=production
ENV PORT=5000

# Copy node_modules and code
COPY --from=builder /usr/src/app ./

# Non-root user for security
USER node

EXPOSE 5000

CMD ["node", "src/server.js"]
