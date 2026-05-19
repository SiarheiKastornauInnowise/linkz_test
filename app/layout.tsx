import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/LogoutButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seat Reservation Assessment",
  description: "A small seat reservation assessment project."
};

type RootLayoutProps = {
  children: ReactNode;
};

export default async function RootLayout({ children }: RootLayoutProps) {
  const user = await getCurrentUser();

  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header className="site-header">
            <Link href="/" className="brand">
              Seat Reservation
            </Link>
            <nav aria-label="Primary navigation">
              <Link href="/seats">Seats</Link>
              {user ? (
                <>
                  <span>{user.email}</span>
                  <LogoutButton className="nav-button" />
                </>
              ) : (
                <Link href="/login">Login</Link>
              )}
            </nav>
          </header>
          <main className="page-shell">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
