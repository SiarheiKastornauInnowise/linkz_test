import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { BadRequestError, errorToResponse } from "@/lib/errors";
import { readJsonBody } from "@/lib/http";
import { completeMockPayment } from "@/lib/payment-service";

const completeMockPaymentSchema = z.object({
  paymentIntentId: z.uuid(),
  outcome: z.enum(["success", "failure"])
});

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireCurrentUser();
    const body = await readJsonBody(request);

    if (!body.ok) {
      return errorToResponse(body.error);
    }

    const parsedBody = completeMockPaymentSchema.safeParse(body.data);

    if (!parsedBody.success) {
      return errorToResponse(new BadRequestError("Invalid payment completion request"));
    }

    const result = await completeMockPayment(
      currentUser.id,
      parsedBody.data.paymentIntentId,
      parsedBody.data.outcome
    );

    return NextResponse.json({
      reservationId: result.reservationId,
      reservationStatus: result.reservationStatus,
      paymentIntentStatus: result.paymentIntentStatus
    });
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}
