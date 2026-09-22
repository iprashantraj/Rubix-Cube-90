import Link from 'next/link';
import './admin.css';
import { DEMO } from '@/lib/admin';

/** Admin console shell. Cluster coordinators and agency staff — the institutional users
 *  who actually touch a keyboard. Multi-tenant: each agency sees only its own artisans.
 *
 *  ⚠️ There is no auth on this build and the rail says so. `StaffUser` exists in
 *  `api/models.py` with a password hash and a `cluster_id` to scope by, but nothing
 *  checks it yet, so every page here shows every cluster. Wire `/admin` (the login) and
 *  a middleware before this points at real rows — a console that serves fixtures needs no
 *  gate, one that serves artisans' orders does. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="adm">
      <nav>
        <div className="mark">
          <span className="g">क</span>
          <span>
            <b>Kaarigar</b>
            <i>Admin console</i>
          </span>
        </div>
        <Link href="/admin">Overview</Link>
        <Link href="/admin/artisans">Artisans</Link>
        <Link href="/admin/queue">Listing queue</Link>
        <Link href="/admin/gem-recon">GeM reconciliation</Link>
        <Link href="/admin/orders">Orders</Link>
        <Link href="/admin/hub">Cluster hub</Link>
        <Link href="/admin/reports">Reports</Link>
        {DEMO && (
          <div className="railfoot">
            <span className="demo">
              <b>Demo data</b>
              Every figure here is a fixture. No database is connected to this build.
            </span>
          </div>
        )}
      </nav>
      <main>{children}</main>
    </div>
  );
}
