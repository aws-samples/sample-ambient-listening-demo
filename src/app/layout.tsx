import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ambient Clinical Documentation Demo',
  description: 'Amazon Connect Health ambient clinical documentation demonstration',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
