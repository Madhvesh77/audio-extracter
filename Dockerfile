FROM node:22-bookworm-slim

ENV DENO_INSTALL=/usr/local
ENV PATH="/usr/local/bin:${PATH}"
ENV NODE_ENV=production

# Install FFmpeg and the utilities needed during setup.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for YouTube's JavaScript challenge handling.
RUN curl -fsSL https://deno.land/install.sh | sh

# Install the standalone Linux version of yt-dlp.
RUN curl -fsSL \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# Install the Node.js dependencies.
COPY package*.json ./
RUN npm install --omit=dev

# Copy the DadTube application.
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
