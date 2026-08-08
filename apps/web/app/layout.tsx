import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { validateWebEnvironment } from '../src/environment';
import './globals.css';

validateWebEnvironment();

export const metadata: Metadata = {
  description: 'İkiMetr realtor workspace',
  title: 'İkiMetr',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="az">
      <body>{children}</body>
    </html>
  );
}
