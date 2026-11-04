import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server Actions receive file uploads (receipts, avatars) as FormData; the
  // default 1 MB body limit rejects a phone photo, so lift it to 4 MB.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  // Telemetry ingest is called by mobile clients, not the browser, so the
  // usual same-origin assumption does not hold -- CORS is set per-route in
  // src/app/api/telemetry/*, not globally.
  poweredByHeader: false,
};

export default nextConfig;
