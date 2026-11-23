# Builds Rephraser and serves it with nginx.
#
#   npm run setup:rephrase          # optional: include the rephrase model (~250 MB)
#   docker build -f deploy/Dockerfile -t rephraser .
#   docker run -p 8080:80 rephraser   # → http://localhost:8080
#
# Anything in public/models/ when you build is included in the image.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY stubs ./stubs
COPY scripts ./scripts
COPY rephrase-model.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
