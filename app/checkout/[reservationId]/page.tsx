import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { CheckoutClient } from "@/components/widgets/checkout/CheckoutClient";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { getReservationCheckoutDetails } from "@/lib/reservation-service";
import { type CheckoutReservationDto } from "@/types";

type CheckoutPageProps = {
  params: Promise<{
    reservationId: string;
  }>;
};

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { reservationId } = await params;
  const parsedReservationId = z.uuid().safeParse(reservationId);

  if (!parsedReservationId.success) {
    notFound();
  }

  const currentUser = await getAuthenticatedUser();
  const reservation = await getCheckoutReservation(currentUser.id, parsedReservationId.data);

  return (
    <section className="page-section">
      <h1>Checkout</h1>
      <CheckoutClient reservation={reservation} />
    </section>
  );
}

async function getAuthenticatedUser() {
  try {
    return await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }

    throw error;
  }
}

async function getCheckoutReservation(
  userId: string,
  reservationId: string
): Promise<CheckoutReservationDto> {
  try {
    const reservation = await getReservationCheckoutDetails(userId, reservationId);

    return {
      ...reservation,
      expiresAt: reservation.expiresAt?.toISOString() ?? null
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      notFound();
    }

    throw error;
  }
}
