"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { Icons } from "@/components/ui/icons";
import { cn } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV: NavItem[] = [
  { href: "/home",       label: "Home",       icon: Icons.home },
  { href: "/manifests",  label: "Manifests",  icon: Icons.ship },
  { href: "/shipments",  label: "Shipments",  icon: Icons.box },
  { href: "/billing",    label: "Billing",    icon: Icons.bill },
  { href: "/accounting", label: "Accounting", icon: Icons.money },
  { href: "/clients",    label: "Clients",    icon: Icons.users },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="sb-navrow">
      {NAV.map(({ href, label, icon: Icon }) => {
        // active when the path starts with the section root (so /shipments/123
        // still highlights "Shipments")
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link key={href} href={href} className={cn("sb-navtab", active && "is-active")}>
            <Icon />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
