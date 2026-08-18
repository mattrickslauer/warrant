# Static landing page on Cloud Run. ~12MB image, sub-second cold start,
# scales to zero — no request, no cost.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
