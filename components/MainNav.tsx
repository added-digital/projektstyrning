"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/belaggning-personer", label: "Beläggning" },
  { href: "/tid", label: "Tid" },
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
            className={`btn btn-mute toolbar-btn main-nav-link ${active ? "active" : ""}`}
            aria-current={active ? "page" : undefined}
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
