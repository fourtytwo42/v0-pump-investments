/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
    loader: 'custom',
    loaderFile: './lib/image-loader.ts',
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.optimization.moduleIds = 'deterministic';
    }
    return config;
  },
}

export default nextConfig
