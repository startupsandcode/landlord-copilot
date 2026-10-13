import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Landlord Triage Copilot',
  description: 'SMS-native maintenance triage and vendor dispatch for self-managing landlords.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <a href="/" className="brand">Triage Copilot</a>
          <div className="links">
            <a href="/dashboard">Dashboard</a>
            <a href="/simulate">Simulate SMS</a>
          </div>
        </nav>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
