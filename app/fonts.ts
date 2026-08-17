import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';

/** Space Grotesk for the interface, IBM Plex Mono for every figure. */
export const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--ff-display',
  display: 'swap',
});

export const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--ff-mono',
  display: 'swap',
});
