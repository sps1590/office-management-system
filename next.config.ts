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
  /*
     Response headers. Vercel already sends HSTS; nothing was sending the
     rest, so the app could be framed by any site and the full URL of every
     page leaked to third parties.

     The CSP carries `frame-ancestors` and nothing else on purpose. A full
     policy needs a nonce on every inline script Next.js emits, and a
     half-written one breaks the app in production rather than at build time;
     `frame-ancestors` restricts no resource, so it is safe on its own and
     covers the clickjacking hole that X-Frame-Options misses in browsers
     that ignore it.
  */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          /*
             The map loads OpenStreetMap tiles and geocodes through Nominatim
             from the browser, so without this the path of whatever page the
             person is on -- /employees/<id>, say -- is sent to a tile server
             on every tile. Origin only, cross-origin.
          */
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          /*
             Geolocation stays on: the location picker and the PWA tracker
             both ask for it, and only from this origin. Everything else the
             product never uses is denied outright.
          */
          {
            key: "Permissions-Policy",
            value:
              "geolocation=(self), camera=(), microphone=(), payment=(), " +
              "usb=(), magnetometer=(), gyroscope=(), accelerometer=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
