# Một Dockerfile dùng chung cho cả 6 service: docker build --build-arg SERVICE=auth-service .
FROM node:22-alpine
ARG SERVICE
ENV NODE_ENV=production
WORKDIR /app

# Lớp cài thư viện (chỉ đổi khi package.json đổi => build lại nhanh hơn)
COPY package.json ./
COPY libs/common/package.json libs/common/package.json
COPY services/${SERVICE}/package.json services/${SERVICE}/package.json
RUN npm install --omit=dev --no-audit --no-fund -w services/${SERVICE}

# Mã nguồn
COPY libs/common libs/common
COPY proto proto
COPY services/${SERVICE} services/${SERVICE}

ENV PROTO_DIR=/app/proto
WORKDIR /app/services/${SERVICE}
USER node
CMD ["node", "src/server.js"]
