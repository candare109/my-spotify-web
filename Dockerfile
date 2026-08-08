# Static site image for the Spotify web clone.
# Nothing to build - this is plain HTML/CSS/JS served directly by nginx.
FROM nginx:1.27-alpine

# Custom nginx config (caching, security headers, correct MIME/error handling)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Site content
COPY . /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
