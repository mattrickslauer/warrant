/** @type {import('next').NextConfig} */
export default {
  // Cloud Run wants a self-contained server. Same Dockerfile shape as infra/.
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
};
