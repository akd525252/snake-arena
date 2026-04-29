import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../contexts/AuthContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "Snake Arena | Multiplayer Snake Battles With Demo & USDT Modes",
    template: "%s | Snake Arena",
  },
  description: "Play real-time multiplayer snake battles with demo mode, competitive arenas, skill-based gameplay, wallet tools, skins, and USDT match rewards.",
  keywords: [
    "Snake Arena",
    "multiplayer snake game",
    "crypto snake game",
    "USDT game",
    "browser snake battle",
    "play snake online",
    "demo snake game",
    "Phaser snake game",
  ],
  applicationName: "Snake Arena",
  authors: [{ name: "Snake Arena" }],
  creator: "Snake Arena",
  publisher: "Snake Arena",
  category: "Game",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "Snake Arena",
    title: "Snake Arena | Multiplayer Snake Battles",
    description: "Enter a neon arena, collect coins, use skills, survive opponents, and play in demo or USDT match modes.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Snake Arena | Multiplayer Snake Battles",
    description: "A neon cyberpunk multiplayer snake game with demo battles, skins, skills, wallet tools, and USDT match rewards.",
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#05050a] text-[#e0e0e8]">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
