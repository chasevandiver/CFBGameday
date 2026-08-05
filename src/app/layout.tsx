import type { Metadata, Viewport } from "next";
import { Archivo, Graduate, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-body",
  subsets: ["latin"],
});

const graduate = Graduate({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-numeric",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "The CFB Slate",
    template: "%s · The CFB Slate",
  },
  description:
    "College football ratings, edges, pick'em, and the crew ledger — what matters right now, every Saturday.",
  applicationName: "The CFB Slate",
};

export const viewport: Viewport = {
  themeColor: "#08251C",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${graduate.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
