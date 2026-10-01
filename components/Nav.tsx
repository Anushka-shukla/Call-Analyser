'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Today' },
  { href: '/categories', label: 'Categories' },
  { href: '/calls', label: 'Calls' },
  { href: '/root-causes', label: 'Root causes' },
  { href: '/returns', label: 'Returns and replacements' },
  { href: '/agents', label: 'Agents' },
  { href: '/alerts', label: 'Alerts' },
];

export default function Nav() {
  const path = usePathname();
  if (path === '/login') return null;
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        <Link href="/" className="brand">Call <span>analyzer</span></Link>
        {LINKS.map((l) => {
          const active = l.href === '/' ? path === '/' : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
