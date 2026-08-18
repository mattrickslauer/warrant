# Static landing page on Cloud Run. Small image, sub-second cold start,
# scales to zero — no request, no container, no charge.
# Build context is the repo root.
FROM nginx:1.27-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
