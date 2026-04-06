import type { NextConfig } from "next";

/**
 * 카카오맵 SDK 등 일부 스크립트가 eval을 사용할 수 있어 script-src에 'unsafe-eval' 포함.
 * 배포 환경에서 별도 CSP를 쓰는 경우 이 헤더와 중복·충돌하지 않도록 정리할 것.
 */
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://dapi.kakao.com https://*.kakao.com",
  "connect-src 'self' https: wss:",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: ContentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
