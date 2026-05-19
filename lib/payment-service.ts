import { randomUUID } from "node:crypto";
import {
  PaymentIntentStatus,
  ReservationStatus,
  type PaymentIntent,
  type Prisma
} from "@/lib/generated/prisma/client";
import { z } from "zod";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError
} from "@/lib/errors";
import { recordPaymentTransaction } from "@/lib/payment-audit";
import { prisma } from "@/lib/prisma";
import { lockSeatForReservation } from "@/lib/seat-lock";
import {
  ACTIVE_PAYMENT_INTENT_STATUSES,
  PAYMENT_PROVIDER,
  MOCK_PAYMENT_FAILED_REASON,
  PAYABLE_RESERVATION_STATUSES,
  RESERVATION_EXPIRED_REASON
} from "@/consts";
import {
  type MockPaymentGatewayEventType,
  type MockPaymentOutcome,
  type MockPaymentResult,
  type MockPaymentResultStatus,
  type ProcessMockPaymentGatewayEventInput
} from "@/types";
const uuidSchema = z.uuid();
const providerEventIdSchema = z.string().trim().min(1).max(200);

type TransactionClient = Prisma.TransactionClient;

export async function createPaymentIntentForReservation(
  userId: string,
  reservationId: string
): Promise<PaymentIntent> {
  assertUuid(reservationId, "reservationId");

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reservation = await lockReservationForUpdate(tx, reservationId);
    const reservationStatusBefore = reservation.status;
    let reservationStatusAfter = reservation.status;

    if (reservation.userId !== userId) {
      throw new ForbiddenError("Reservation is not yours");
    }

    if (reservation.status === ReservationStatus.paid) {
      throw new ConflictError("Paid reservation does not need a new payment intent");
    }

    if (reservation.status === ReservationStatus.cancelled) {
      throw new ConflictError("Cancelled reservation cannot be paid");
    }

    if (reservation.status === ReservationStatus.expired) {
      throw new ConflictError("Expired reservation cannot be paid");
    }

    if (isExpired(reservation.expiresAt, now)) {
      await expireReservation(tx, reservation.id, reservation.status);
      throw new ConflictError("Reservation expired");
    }

    if (!isPayableReservationStatus(reservation.status)) {
      throw new ConflictError("Reservation cannot be paid");
    }

    if (reservation.status === ReservationStatus.payment_failed) {
      const movedToPendingResult = await tx.reservation.updateMany({
        where: {
          id: reservation.id,
          status: ReservationStatus.payment_failed
        },
        data: { status: ReservationStatus.pending_payment }
      });

      if (movedToPendingResult.count === 0) {
        throw new ConflictError("Reservation cannot be paid");
      }

      reservationStatusAfter = ReservationStatus.pending_payment;
    }

    const activePaymentIntent = await tx.paymentIntent.findFirst({
      where: {
        reservationId: reservation.id,
        status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
      },
      orderBy: { createdAt: "desc" }
    });

    if (activePaymentIntent) {
      return activePaymentIntent;
    }

    const paymentIntent = await tx.paymentIntent.create({
      data: {
        reservationId: reservation.id,
        provider: PAYMENT_PROVIDER,
        status: PaymentIntentStatus.requires_payment
      }
    });

    await recordPaymentTransaction(tx, {
      reservationId: reservation.id,
      paymentIntentId: paymentIntent.id,
      provider: paymentIntent.provider,
      eventType: "payment_intent.created",
      paymentIntentStatusAfter: paymentIntent.status,
      reservationStatusBefore,
      reservationStatusAfter
    });

    return paymentIntent;
  });
}

export async function completeMockPayment(
  userId: string,
  paymentIntentId: string,
  outcome: MockPaymentOutcome
): Promise<MockPaymentResult> {
  return processMockPaymentGatewayEvent({
    paymentIntentId,
    eventType: eventTypeFromOutcome(outcome),
    providerEventId: `mock-ui:${randomUUID()}`,
    failureReason: outcome === "failure" ? MOCK_PAYMENT_FAILED_REASON : undefined,
    rawPayload: { source: "mock-complete", outcome },
    actingUserId: userId
  });
}

export async function processMockPaymentGatewayEvent(
  input: ProcessMockPaymentGatewayEventInput
): Promise<MockPaymentResult> {
  assertUuid(input.paymentIntentId, "paymentIntentId");
  assertProviderEventId(input.providerEventId);

  try {
    return await prisma.$transaction(async (tx) => {
    const existingTransaction = await tx.paymentTransaction.findUnique({
      where: {
        provider_providerEventId: {
          provider: PAYMENT_PROVIDER,
          providerEventId: input.providerEventId
        }
      },
      select: {
        reservationId: true,
        paymentIntentStatusAfter: true,
        reservationStatusAfter: true
      }
    });

    if (existingTransaction) {
      return paymentResultFromTransaction(existingTransaction);
    }

    const paymentIntentReference = await tx.paymentIntent.findUnique({
      where: { id: input.paymentIntentId },
      select: { reservationId: true }
    });

    if (!paymentIntentReference) {
      throw new NotFoundError("Payment intent not found");
    }

    const reservation = await lockReservationForUpdate(
      tx,
      paymentIntentReference.reservationId
    );

    const paymentIntent = await tx.paymentIntent.findUnique({
      where: { id: input.paymentIntentId }
    });

    if (!paymentIntent) {
      throw new NotFoundError("Payment intent not found");
    }

    if (input.actingUserId && reservation.userId !== input.actingUserId) {
      throw new ForbiddenError("Reservation is not yours");
    }

    await lockSeatForReservation(tx, reservation.seatId);

    if (reservation.status === ReservationStatus.paid) {
      await recordGatewayPaymentTransaction(tx, {
        input,
        paymentIntent,
        reservationStatusBefore: reservation.status,
        reservationStatusAfter: ReservationStatus.paid,
        paymentIntentStatusAfter: paymentIntent.status,
        failureReason: input.failureReason ?? null
      });

      return paymentResult(
        reservation.id,
        ReservationStatus.paid,
        paymentIntent.status
      );
    }

    if (reservation.status === ReservationStatus.cancelled) {
      throw new ConflictError("Cancelled reservation cannot be paid");
    }

    if (reservation.status === ReservationStatus.expired) {
      throw new ConflictError("Expired reservation cannot be paid");
    }

    if (paymentIntent.status === PaymentIntentStatus.failed) {
      await recordGatewayPaymentTransaction(tx, {
        input,
        paymentIntent,
        reservationStatusBefore: reservation.status,
        reservationStatusAfter: ReservationStatus.payment_failed,
        paymentIntentStatusAfter: PaymentIntentStatus.failed,
        failureReason: paymentIntent.failureReason ?? input.failureReason ?? null
      });

      return paymentResult(
        reservation.id,
        ReservationStatus.payment_failed,
        PaymentIntentStatus.failed
      );
    }

    if (paymentIntent.status === PaymentIntentStatus.cancelled) {
      throw new ConflictError("Payment intent is cancelled");
    }

    if (paymentIntent.status === PaymentIntentStatus.succeeded) {
      return paymentResult(
        reservation.id,
        ReservationStatus.paid,
        PaymentIntentStatus.succeeded
      );
    }

    const now = await getDatabaseNow(tx);
    if (isExpired(reservation.expiresAt, now)) {
      await expireReservation(tx, reservation.id, reservation.status);
      throw new ConflictError("Reservation expired");
    }

    if (input.eventType === "payment.failed") {
      const failureReason = input.failureReason ?? MOCK_PAYMENT_FAILED_REASON;
      const failedPaymentIntentResult = await tx.paymentIntent.updateMany({
        where: {
          id: paymentIntent.id,
          status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
        },
        data: {
          status: PaymentIntentStatus.failed,
          failureReason
        }
      });

      if (failedPaymentIntentResult.count === 0) {
        const currentPaymentIntent = await tx.paymentIntent.findUnique({
          where: { id: paymentIntent.id },
          select: { status: true }
        });

        if (currentPaymentIntent?.status === PaymentIntentStatus.succeeded) {
          return paymentResult(
            reservation.id,
            ReservationStatus.paid,
            PaymentIntentStatus.succeeded
          );
        }

        if (currentPaymentIntent?.status === PaymentIntentStatus.failed) {
          return paymentResult(
            reservation.id,
            ReservationStatus.payment_failed,
            PaymentIntentStatus.failed
          );
        }

        throw new ConflictError("Payment intent is cancelled");
      }

      await tx.reservation.updateMany({
        where: {
          id: reservation.id,
          status: { in: [...PAYABLE_RESERVATION_STATUSES] }
        },
        data: { status: ReservationStatus.payment_failed }
      });

      await recordPaymentTransaction(tx, {
        reservationId: reservation.id,
        paymentIntentId: paymentIntent.id,
        provider: paymentIntent.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        paymentIntentStatusBefore: paymentIntent.status,
        paymentIntentStatusAfter: PaymentIntentStatus.failed,
        reservationStatusBefore: reservation.status,
        reservationStatusAfter: ReservationStatus.payment_failed,
        failureReason,
        rawPayload: input.rawPayload
      });

      return paymentResult(
        reservation.id,
        ReservationStatus.payment_failed,
        PaymentIntentStatus.failed
      );
    }

    const succeededPaymentIntentResult = await tx.paymentIntent.updateMany({
      where: {
        id: paymentIntent.id,
        status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
      },
      data: {
        status: PaymentIntentStatus.succeeded,
        failureReason: null
      }
    });

    if (succeededPaymentIntentResult.count === 0) {
      const currentPaymentIntent = await tx.paymentIntent.findUnique({
        where: { id: paymentIntent.id },
        select: { status: true }
      });

      if (currentPaymentIntent?.status === PaymentIntentStatus.succeeded) {
        return paymentResult(
          reservation.id,
          ReservationStatus.paid,
          PaymentIntentStatus.succeeded
        );
      }

      if (currentPaymentIntent?.status === PaymentIntentStatus.failed) {
        return paymentResult(
          reservation.id,
          ReservationStatus.payment_failed,
          PaymentIntentStatus.failed
        );
      }

      throw new ConflictError("Payment intent is cancelled");
    }

    const paidReservationResult = await tx.reservation.updateMany({
      where: {
        id: reservation.id,
        status: { in: [...PAYABLE_RESERVATION_STATUSES] }
      },
      data: {
        status: ReservationStatus.paid,
        expiresAt: null
      }
    });

    if (paidReservationResult.count === 0) {
      throw new ConflictError("Reservation cannot be paid");
    }

    await recordPaymentTransaction(tx, {
      reservationId: reservation.id,
      paymentIntentId: paymentIntent.id,
      provider: paymentIntent.provider,
      providerEventId: input.providerEventId,
      eventType: input.eventType,
      paymentIntentStatusBefore: paymentIntent.status,
      paymentIntentStatusAfter: PaymentIntentStatus.succeeded,
      reservationStatusBefore: reservation.status,
      reservationStatusAfter: ReservationStatus.paid,
      rawPayload: input.rawPayload
    });

    return paymentResult(
      reservation.id,
      ReservationStatus.paid,
      PaymentIntentStatus.succeeded
    );
    });
  } catch (error: unknown) {
    if (isDuplicateProviderEventError(error)) {
      return getProcessedGatewayEventResult(input.providerEventId);
    }

    throw error;
  }
}

type ExistingPaymentTransactionResult = {
  reservationId: string;
  paymentIntentStatusAfter: PaymentIntentStatus;
  reservationStatusAfter: ReservationStatus | null;
};

function paymentResultFromTransaction(
  transaction: ExistingPaymentTransactionResult
): MockPaymentResult {
  return paymentResult(
    transaction.reservationId,
    transaction.reservationStatusAfter === ReservationStatus.paid
      ? ReservationStatus.paid
      : ReservationStatus.payment_failed,
    transaction.paymentIntentStatusAfter
  );
}

async function getProcessedGatewayEventResult(
  providerEventId: string
): Promise<MockPaymentResult> {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: {
      provider_providerEventId: {
        provider: PAYMENT_PROVIDER,
        providerEventId
      }
    },
    select: {
      reservationId: true,
      paymentIntentStatusAfter: true,
      reservationStatusAfter: true
    }
  });

  if (!transaction) {
    throw new ConflictError("Payment gateway event is already being processed");
  }

  return paymentResultFromTransaction(transaction);
}

type GatewayTransactionInput = {
  input: ProcessMockPaymentGatewayEventInput;
  paymentIntent: PaymentIntent;
  reservationStatusBefore: ReservationStatus;
  reservationStatusAfter: ReservationStatus;
  paymentIntentStatusAfter: PaymentIntentStatus;
  failureReason?: string | null;
};

async function recordGatewayPaymentTransaction(
  tx: TransactionClient,
  event: GatewayTransactionInput
): Promise<void> {
  await recordPaymentTransaction(tx, {
    reservationId: event.paymentIntent.reservationId,
    paymentIntentId: event.paymentIntent.id,
    provider: event.paymentIntent.provider,
    providerEventId: event.input.providerEventId,
    eventType: event.input.eventType,
    paymentIntentStatusBefore: event.paymentIntent.status,
    paymentIntentStatusAfter: event.paymentIntentStatusAfter,
    reservationStatusBefore: event.reservationStatusBefore,
    reservationStatusAfter: event.reservationStatusAfter,
    failureReason: event.failureReason ?? null,
    rawPayload: event.input.rawPayload
  });
}

function eventTypeFromOutcome(outcome: MockPaymentOutcome): MockPaymentGatewayEventType {
  return outcome === "success" ? "payment.succeeded" : "payment.failed";
}

function paymentResult(
  reservationId: string,
  reservationStatus: MockPaymentResultStatus,
  paymentIntentStatus: PaymentIntentStatus
): MockPaymentResult {
  return {
    reservationId,
    reservationStatus,
    paymentIntentStatus
  };
}

async function expireReservation(
  tx: TransactionClient,
  reservationId: string,
  reservationStatusBefore: ReservationStatus
): Promise<void> {
  const activePaymentIntents = await tx.paymentIntent.findMany({
    where: {
      reservationId,
      status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
    },
    select: {
      id: true,
      provider: true,
      status: true
    }
  });

  await tx.reservation.update({
    where: { id: reservationId },
    data: { status: ReservationStatus.expired }
  });

  await cancelActivePaymentIntents(
    tx,
    reservationId,
    RESERVATION_EXPIRED_REASON
  );

  for (const paymentIntent of activePaymentIntents) {
    await recordPaymentTransaction(tx, {
      reservationId,
      paymentIntentId: paymentIntent.id,
      provider: paymentIntent.provider,
      eventType: "payment_intent.expired",
      paymentIntentStatusBefore: paymentIntent.status,
      paymentIntentStatusAfter: PaymentIntentStatus.cancelled,
      reservationStatusBefore,
      reservationStatusAfter: ReservationStatus.expired,
      failureReason: RESERVATION_EXPIRED_REASON
    });
  }
}

async function cancelActivePaymentIntents(
  tx: TransactionClient,
  reservationId: string,
  failureReason: string
): Promise<void> {
  await tx.paymentIntent.updateMany({
    where: {
      reservationId,
      status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
    },
    data: {
      status: PaymentIntentStatus.cancelled,
      failureReason
    }
  });
}

function isPayableReservationStatus(status: ReservationStatus): boolean {
  return PAYABLE_RESERVATION_STATUSES.includes(
    status as (typeof PAYABLE_RESERVATION_STATUSES)[number]
  );
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt < now;
}

function assertUuid(value: string, field: string): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new BadRequestError(`Invalid ${field}`);
  }
}

function assertProviderEventId(value: string): void {
  if (!providerEventIdSchema.safeParse(value).success) {
    throw new BadRequestError("Invalid providerEventId");
  }
}

function isDuplicateProviderEventError(error: unknown): boolean {
  if (!isObjectWithCode(error) || error.code !== "P2002") {
    return false;
  }

  const target = isObject(error.meta) ? error.meta.target : undefined;

  return (
    Array.isArray(target) &&
    target.includes("provider") &&
    target.includes("providerEventId")
  );
}

function isObjectWithCode(error: unknown): error is { code?: unknown; meta?: unknown } {
  return isObject(error) && "code" in error;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type LockedReservationRow = {
  id: string;
  userId: string;
  seatId: string;
  status: ReservationStatus;
  expiresAt: Date | null;
};
async function lockReservationForUpdate(
  tx: TransactionClient,
  reservationId: string
): Promise<LockedReservationRow> {
  const rows = await tx.$queryRaw<LockedReservationRow[]>`
    SELECT id, "userId", "seatId", status, "expiresAt"
    FROM reservations
    WHERE id = ${reservationId}::uuid
    FOR UPDATE
  `;
  const [reservation] = rows;

  if (!reservation) {
    throw new NotFoundError("Reservation not found");
  }

  return reservation;
}

async function getDatabaseNow(tx: TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`
    SELECT CURRENT_TIMESTAMP AS now
  `;
  return rows[0].now;
}
