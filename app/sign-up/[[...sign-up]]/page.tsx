import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function SignUpPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/seats");
  }

  return (
    <section className="page-section">
      <h1>Sign Up</h1>
      <SignUp routing="path" path="/sign-up" signInUrl="/login" fallbackRedirectUrl="/seats" />
    </section>
  );
}
