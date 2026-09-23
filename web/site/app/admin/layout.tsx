import Link from 'next/link';

/** Admin console shell. Cluster coordinators and agency staff — the institutional users
 *  who actually touch a keyboard. Multi-tenant: each agency sees only its own artisans. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="side">
      <nav>
        <b>Kala Setu admin</b>
        <Link href="/admin/artisans">Artisans</Link>
        <Link href="/admin/queue">Listing queue</Link>
        <Link href="/admin/gem-recon">GeM reconciliation</Link>
        <Link href="/admin/orders">Orders</Link>
        <Link href="/admin/hub">Cluster hub</Link>
        <Link href="/admin/reports">Reports</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
