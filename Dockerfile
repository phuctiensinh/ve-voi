# Vẽ Vời — ảnh Docker gọn: không có dependency nên chỉ cần chép mã nguồn.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]
