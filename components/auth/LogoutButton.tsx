"use client";

import { SignOutButton } from "@clerk/nextjs";

type LogoutButtonProps = {
  className?: string;
};

export function LogoutButton({ className }: LogoutButtonProps) {
  return (
    <SignOutButton redirectUrl="/login">
      <button className={className} type="button">
        Logout
      </button>
    </SignOutButton>
  );
}
