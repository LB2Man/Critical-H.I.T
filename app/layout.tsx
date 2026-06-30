import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Critical H.I.T",
  description: "A Firebase-powered Dungeons and Dragons combat tracker.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
