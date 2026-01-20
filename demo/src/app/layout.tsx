import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DRAIN Demo | Pay-per-Token AI',
  description: 'Trustless AI payments with USDC on Polygon',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0A0A0A] text-white min-h-screen">
        {children}
      </body>
    </html>
  );
}
