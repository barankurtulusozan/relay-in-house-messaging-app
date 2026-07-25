import './globals.css';
import React from 'react';

export const metadata = {
  title: 'Relay — Company Internal Chat',
  description: 'High-performance, secure, offline-first internal communication platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
