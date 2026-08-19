import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warrant — maintenance records that are evidence, not paperwork",
  description:
    "A procedure compiles to a form. A technician fills it by capturing, not typing. Agents verify what arrives, and nothing is released until every step holds up.",
};

export const viewport: Viewport = {
  themeColor: "#0E1719",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
