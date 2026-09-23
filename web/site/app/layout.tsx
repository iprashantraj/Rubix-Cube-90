import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kala Setu — handmade, direct from the artisan',
  description:
    'Buy directly from verified Indian artisans and weavers. GI-tagged crafts, bulk quotes, and the story behind every piece.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
