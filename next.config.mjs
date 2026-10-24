/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // No image optimization is needed for this screen.
  images: { unoptimized: true }
};

export default nextConfig;
