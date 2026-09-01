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
      <form action="/auth/signout" method="post" className="main-nav-signout-form" style={{ marginLeft: "auto" }}>
        <button type="submit" className="main-nav-signout">
          Logga ut
        </button>
      </form>
    </nav>
  );
}
