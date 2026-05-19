import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";

export default function SuccessPage() {
  return <SuccessContent />;
}

async function SuccessContent() {
  try {
    await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }

    throw error;
  }

  return (
    <section className="page-section">
      <div className="status-panel">
        <h1>Reservation confirmed</h1>
        <p>Your seat has been reserved successfully.</p>
        <Link className="button-link" href="/seats">
          Back to seats
        </Link>
      </div>
    </section>
  );
}
