import type { NextConfig } from 'next';

const config: NextConfig = {
  // PWA-ready output
  output: 'standalone',
  // Required for Socket.IO WebSocket upgrade
  async rewrites() {
    return [
      {
        source: '/socket.io/:path*',
        destination: `${process.env.NEXT_PUBLIC_SIGNALING_URL}/socket.io/:path*`,
      },
    ];
  },
};

export default config;
