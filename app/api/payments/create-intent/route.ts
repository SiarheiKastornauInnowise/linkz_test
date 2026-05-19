import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { BadRequestError, errorToResponse } from "@/lib/errors";
import { readJsonBody } from "@/lib/http";
import { createPaymentIntentForReservation } from "@/lib/payment-service";

const createPaymentIntentSchema = z.object({
  reservationId: z.uuid()
});

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const body = await readJsonBody(request);

    if (!body.ok) {
      return errorToResponse(body.error);
    }

    const parsedBody = createPaymentIntentSchema.safeParse(body.data);

    if (!parsedBody.success) {
      return errorToResponse(new BadRequestError("Invalid payment intent request"));
    }

    const paymentIntent = await createPaymentIntentForReservation(
      currentUser.id,
      parsedBody.data.reservationId
    );

    return NextResponse.json(
      {
        paymentIntentId: paymentIntent.id,
        reservationId: paymentIntent.reservationId,
        status: paymentIntent.status
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}
