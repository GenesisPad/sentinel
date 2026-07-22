"use client";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ExternalLink, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const NAV = [
  { label: "Analytics", href: "/analytics" },
  { label: "Explore", href: "/explore" },
  { label: "API", href: "/api" },
  { label: "Docs", href: "/docs" },
];

/** /pricing and /blog never had pages behind them — replaced with real destinations in the
 * wider GenesisPad ecosystem rather than links that 404. */
const ECOSYSTEM_NAV = [
  { label: "Main Site", href: "https://genesispad.app" },
  { label: "Launchpad", href: "https://launch.genesispad.app" },
  { label: "Locker", href: "https://locker.genesispad.app" },
  { label: "Buybot", href: "https://t.me/genesis_buybot" },
];

export function SiteHeader() {
  return (
    <header className="mx-auto flex max-w-[1360px] items-center justify-between gap-6 px-5 py-5 sm:px-7">
      <Link href="/" className="flex items-center gap-3" aria-label="Genesis Sentinel home">
        <img src="/brand/logo.png" alt="" className="size-10 rounded-xl border border-primary/25 bg-surface-deep object-cover" />
        <span className="font-display text-[15px] font-bold leading-none tracking-[0.06em]">
          <span className="block">GENESIS</span>
          <span className="block text-primary">SENTINEL</span>
        </span>
      </Link>

      <nav className="hidden items-center gap-7 md:flex" aria-label="Primary">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="text-[15px] font-semibold text-secondary transition-colors hover:text-foreground">
            {n.label}
          </Link>
        ))}
        {ECOSYSTEM_NAV.map((n) => (
          <a
            key={n.href}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[14px] font-semibold text-muted transition-colors hover:text-foreground"
          >
            {n.label}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-2.5">
        <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
          Sign In
        </Button>
        <Button size="sm" className="hidden sm:inline-flex">
          Sign Up
        </Button>
        <MobileNav />
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Open menu"
          className="group flex size-11 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:hidden"
        >
          <Menu className="size-5 group-data-[state=open]:hidden" aria-hidden />
          <X className="hidden size-5 group-data-[state=open]:block" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          className="z-40 w-56 rounded-xl border border-border-strong bg-surface-deep p-1.5 shadow-xl"
        >
          {NAV.map((n) => (
            <DropdownMenu.Item key={n.href} asChild>
              <Link
                href={n.href}
                className="flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground outline-none data-[highlighted]:bg-[#161a12]"
              >
                {n.label}
              </Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          {ECOSYSTEM_NAV.map((n) => (
            <DropdownMenu.Item key={n.href} asChild>
              <a
                href={n.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold text-foreground outline-none data-[highlighted]:bg-[#161a12]"
              >
                {n.label}
                <ExternalLink className="size-3.5 text-faint" aria-hidden />
              </a>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="my-1.5 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-secondary outline-none data-[highlighted]:bg-[#161a12]"
            >
              Sign In
            </button>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center rounded-lg px-3 py-2.5 text-left text-sm font-bold text-primary outline-none data-[highlighted]:bg-[#161a12]"
            >
              Sign Up
            </button>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
