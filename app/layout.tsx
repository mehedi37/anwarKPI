import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { display, mono } from './fonts';
import { ensureSeeded } from '@/lib/seed';
import { allUsers, currentUser, CAN, ROLE_LABEL } from '@/lib/session';
import { RoleSwitcher } from '@/components/RoleSwitcher';

export const metadata: Metadata = {
  title: 'Anwar KPIFlow',
  description:
    '',
};

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  ensureSeeded();
  const user = await currentUser();
  const users = allUsers();

  const nav = [
    { href: '/', label: 'Overview', show: true },
    { href: '/setup', label: 'KPI setup', show: CAN.setupKpi(user) },
    { href: '/my-kpis', label: 'My KPIs', show: user.role === 'employee' },
    { href: '/review', label: 'Review', show: CAN.review(user) && user.role === 'manager' },
    { href: '/approve', label: 'Approvals', show: CAN.approve(user) },
    { href: '/summary', label: 'Summary', show: true },
    { href: '/dashboard', label: 'Dashboard', show: CAN.dashboard(user) },
  ].filter((n) => n.show);

  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="border-b border-ink bg-ink text-paper">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
            <Link href="/" className="group flex items-baseline gap-2.5">
              <span className="text-lg font-bold tracking-tight">Anwar KPIFlow</span>
            </Link>
            <RoleSwitcher users={users} current={user} />
          </div>
          <nav className="border-t border-paper/12">
            <div className="mx-auto flex max-w-6xl flex-wrap px-5">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="label border-b-2 border-transparent px-3 py-2.5 text-paper/65 transition-colors hover:border-paper/40 hover:text-paper"
                >
                  {n.label}
                </Link>
              ))}
            </div>
          </nav>
        </header>

        <div className="border-b border-rule bg-paper">
          <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-2 px-5 py-2 text-xs text-ink2">
            <span className="label text-ink3">acting as</span>
            <strong className="font-semibold text-ink">{user.name}</strong>
            <span className="text-ink3">
              {user.title} · {ROLE_LABEL[user.role]}
              {user.dept_name ? ` · ${user.dept_name}` : ''}
            </span>
          </div>
        </div>

        <main className="mx-auto max-w-6xl px-5 py-9">{children}</main>

        <footer className="mx-auto max-w-6xl px-5 pb-10">
          <p className="border-t border-rule pt-4 text-xs text-ink3">
            Md. Mehedi Hasan Maruf | Demo data only. BDT figures and
            people are fictional.
          </p>
        </footer>
      </body>
    </html>
  );
}
