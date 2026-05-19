import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { BadRequestError, errorToResponse } from "@/lib/errors";
import { readJsonBody } from "@/lib/http";
import { createReservationHold } from "@/lib/reservation-service";

const createReservationSchema = z.object({
  seatId: z.uuid()
});

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const body = await readJsonBody(request);

    if (!body.ok) {
      return errorToResponse(body.error);
    }

    const parsedBody = createReservationSchema.safeParse(body.data);

    if (!parsedBody.success) {
      return errorToResponse(new BadRequestError("Invalid reservation request"));
    }

    const hold = await createReservationHold(currentUser.id, parsedBody.data.seatId);

    return NextResponse.json(
      {
        reservationId: hold.reservation.id,
        paymentIntentId: hold.paymentIntent.id,
        seatId: hold.reservation.seatId,
        status: hold.reservation.status,
        expiresAt: hold.reservation.expiresAt
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}
