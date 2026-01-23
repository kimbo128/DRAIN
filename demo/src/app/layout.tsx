import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DRAIN | AI Payment Infrastructure',
  description: 'Trustless micropayments for AI inference. Pay-per-token with USDC on Polygon.',
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚡</text></svg>',
  },
  openGraph: {
    title: 'DRAIN | AI Payment Infrastructure',
    description: 'Trustless micropayments for AI inference. No credit cards, no tokens, just USDC.',
    type: 'website',
  },
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
