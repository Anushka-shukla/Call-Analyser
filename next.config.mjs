/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'ffmpeg-static'],
  outputFileTracingIncludes: {
    '/api/cron/**': ['./node_modules/ffmpeg-static/ffmpeg'],
  },
};
export default nextConfig;