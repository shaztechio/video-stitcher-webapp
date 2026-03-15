FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Ensure upload and output directories exist
RUN mkdir -p uploads output

EXPOSE 3000

CMD ["node", "index.js"]
