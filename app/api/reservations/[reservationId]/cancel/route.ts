import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { BadRequestError, errorToResponse } from "@/lib/errors";
import { cancelReservation } from "@/lib/reservation-service";

type CancelReservationContext = {
  params: Promise<{
    reservationId: string;
  }>;
};

export async function POST(_request: Request, { params }: CancelReservationContext) {
  try {
    const currentUser = await requireCurrentUser();
    const { reservationId } = await params;
    const parsedReservationId = z.uuid().safeParse(reservationId);

    if (!parsedReservationId.success) {
      return errorToResponse(new BadRequestError("Invalid reservation id"));
    }

    const reservation = await cancelReservation(currentUser.id, parsedReservationId.data);

    return NextResponse.json({
      reservationId: reservation.id,
      status: reservation.status
    });
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}
