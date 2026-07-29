import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { Icons } from "@/components/ui/icons";

/**
 * The persistent chrome around every authenticated page: top bar + nav.
 *
 * This is a Server Component. In your real app, fetch the current user/org
 * here (from your session) and pass their name/initials into the org chip and
 * avatar instead of the hardcoded values below.
 */
export function AppShell({
  children,
  org = "Blue Brokerage",
  userInitials = "JM",
}: {
  children: ReactNode;
  org?: string;
  userInitials?: string;
}) {
  return (
    <div className="sb sb-shell">
      <header className="sb-topbar">
        <div className="sb-brand">
          <span className="sb-logo">S</span>
          submit<span className="sb-tld">.app</span>
        </div>

        <div className="sb-gsearch">
          <Icons.search />
          <input placeholder="Search shipments, BL #, client, HS code…" />
          <span className="sb-kbd">⌘K</span>
        </div>

        <div style={{ flex: 1 }} />

        <div className="sb-org"><span className="sb-live" /> {org}</div>
        <button className="sb-iconbtn" aria-label="Notifications">
          <Icons.bell />
        </button>
        <div className="sb-avatar" title="Account">{userInitials}</div>
      </header>

      <Nav />

      <div className="sb-scroll">{children}</div>
    </div>
  );
}
