import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { UnauthorizedError } from "@/lib/errors";
import { listSeatsWithAvailability } from "@/lib/reservation-service";
import { SeatsClient } from "@/components/widgets/seats/SeatsClient";
import { type SeatItemDto } from "@/types";

export default async function SeatsPage() {
  let userEmail: string;
  let userId: string;

  try {
    const user = await requireCurrentUser();
    userId = user.id;
    userEmail = user.email;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }

    throw error;
  }

  const seats = await listSeatsWithAvailability(userId);
  const seatItems: SeatItemDto[] = seats.map((seat) => ({
    ...seat,
    holdExpiresAt: seat.holdExpiresAt?.toISOString()
  }));

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <h1>Seats</h1>
          <p>Signed in as {userEmail}.</p>
        </div>
      </div>
      <SeatsClient seats={seatItems} />
    </section>
  );
}
