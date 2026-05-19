import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/seats");
  }

  return (
    <section className="page-section">
      <h1>Login</h1>
      <SignIn routing="path" path="/login" signUpUrl="/sign-up" fallbackRedirectUrl="/seats" />
    </section>
  );
}
