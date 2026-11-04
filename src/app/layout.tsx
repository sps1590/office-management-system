import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Office Management System",
    template: "%s · OMS",
  },
  description:
    "Enterprise office management: HR, fleet, procurement & supply chain, finance, CRM and field operations, with a live operations map and GPS telemetry.",
  applicationName: "OMS",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#080b14" },
  ],
};

// Resolves the theme before first paint, so a dark-mode user never sees a
// white flash. Kept inline and tiny for exactly that reason: a React effect
// would run after hydration, which is too late.
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('oms-theme');
  var dark = stored === 'dark' || ((!stored || stored === 'system') &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
