"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Projekt" },
  { href: "/projektplanering", label: "Projektplanering" },
];

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="main-nav" aria-label="Huvudmeny">
      {links.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`main-nav-link ${active ? "active" : ""}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
