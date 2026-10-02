import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Notepad - NiftyDock",
  description: "A quiet place for notes worth sharing.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
