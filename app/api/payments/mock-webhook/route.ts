import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { BadRequestError, UnauthorizedError, errorToResponse } from "@/lib/errors";
import { readJsonBody } from "@/lib/http";
import { processMockPaymentGatewayEvent } from "@/lib/payment-service";

const mockWebhookSchema = z.object({
  paymentIntentId: z.uuid(),
  eventId: z.string().trim().min(1).max(200).optional(),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  failureReason: z.string().trim().min(1).max(500).optional()
});

export async function POST(request: NextRequest) {
  try {
    assertValidMockWebhookSignature(request);

    const body = await readJsonBody(request);

    if (!body.ok) {
      return errorToResponse(body.error);
    }

    const parsedBody = mockWebhookSchema.safeParse(body.data);

    if (!parsedBody.success) {
      return errorToResponse(new BadRequestError("Invalid mock webhook event"));
    }

    const event = parsedBody.data;
    const result = await processMockPaymentGatewayEvent({
      paymentIntentId: event.paymentIntentId,
      eventType: event.type,
      providerEventId: event.eventId ?? `mock-webhook:${randomUUID()}`,
      failureReason: event.failureReason,
      rawPayload: {
        paymentIntentId: event.paymentIntentId,
        eventId: event.eventId ?? null,
        type: event.type,
        failureReason: event.failureReason ?? null
      }
    });

    return NextResponse.json({
      reservationId: result.reservationId,
      reservationStatus: result.reservationStatus,
      paymentIntentStatus: result.paymentIntentStatus
    });
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}

function assertValidMockWebhookSignature(request: NextRequest): void {
  const expectedSignature = process.env.MOCK_PAYMENT_WEBHOOK_SECRET;
  const isDevelopment = process.env.NODE_ENV === "development";
  const actualSignature = request.headers.get("x-mock-payment-signature");

  if (!expectedSignature) {
    if (isDevelopment) {
      return;
    }

    throw new Error("MOCK_PAYMENT_WEBHOOK_SECRET is required outside development");
  }

  if (actualSignature !== expectedSignature) {
    throw new UnauthorizedError("Invalid mock payment webhook signature");
  }
}
