import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { Icons } from "@/components/ui/icons";

/**
 * The persistent chrome around every authenticated page: top bar + nav.
 *
 * This is a Server Component. The authenticated layout resolves the current
 * organization and user initials and passes them into this chrome.
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

        <form className="sb-gsearch" action="/shipments">
          <button type="submit" className="sb-gsearch-submit" aria-label="Search shipments">
            <Icons.search />
          </button>
          <input name="search" aria-label="Search shipments" placeholder="Search shipment, BL #, description…" />
          <span className="sb-kbd">⌘K</span>
        </form>

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
