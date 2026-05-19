import {
  type PaymentIntentStatus,
  type Prisma,
  type ReservationStatus
} from "@/lib/generated/prisma/client";

type TransactionClient = Prisma.TransactionClient;

export type PaymentAuditEvent = {
  reservationId: string;
  paymentIntentId: string;
  provider: string;
  providerEventId?: string | null;
  eventType: string;
  paymentIntentStatusBefore?: PaymentIntentStatus | null;
  paymentIntentStatusAfter: PaymentIntentStatus;
  reservationStatusBefore?: ReservationStatus | null;
  reservationStatusAfter?: ReservationStatus | null;
  failureReason?: string | null;
  rawPayload?: Prisma.InputJsonValue | null;
};

export async function recordPaymentTransaction(
  tx: TransactionClient,
  event: PaymentAuditEvent
): Promise<void> {
  await tx.paymentTransaction.create({
    data: {
      reservationId: event.reservationId,
      paymentIntentId: event.paymentIntentId,
      provider: event.provider,
      providerEventId: event.providerEventId ?? null,
      eventType: event.eventType,
      paymentIntentStatusBefore: event.paymentIntentStatusBefore ?? null,
      paymentIntentStatusAfter: event.paymentIntentStatusAfter,
      reservationStatusBefore: event.reservationStatusBefore ?? null,
      reservationStatusAfter: event.reservationStatusAfter ?? null,
      failureReason: event.failureReason ?? null,
      rawPayload: event.rawPayload ?? undefined
    }
  });
}
