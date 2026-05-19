import {
  PaymentIntentStatus,
  ReservationStatus,
  type Reservation,
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
  CANCELLABLE_PAYMENT_INTENT_STATUSES,
  PAYMENT_PROVIDER,
  CANCELLATION_FAILURE_REASON,
  HOLD_DURATION_MINUTES,
  HOLDING_RESERVATION_STATUSES,
  RESERVATION_EXPIRED_REASON
} from "@/consts";
import {
  type ReservationCheckoutDetails,
  type ReservationHold,
  type SeatWithAvailability
} from "@/types";
const uuidSchema = z.uuid();

type BlockingReservation = Pick<
  Reservation,
  "id" | "status" | "expiresAt" | "userId"
>;
type TransactionClient = Prisma.TransactionClient;

export async function listSeatsWithAvailability(
  currentUserId: string
): Promise<SeatWithAvailability[]> {
  const now = new Date();
  const seats = await prisma.seat.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      reservations: {
        where: activeReservationWhere(now),
        select: {
          id: true,
          status: true,
          expiresAt: true,
          userId: true
        }
      }
    }
  });

  return seats.map((seat) => ({
    id: seat.id,
    code: seat.code,
    ...availabilityFromReservations(seat.reservations, currentUserId)
  }));
}

export async function getReservationCheckoutDetails(
  userId: string,
  reservationId: string
): Promise<ReservationCheckoutDetails> {
  assertUuid(reservationId, "reservationId");

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reservation = await lockReservationForUpdate(tx, reservationId);

    if (reservation.userId !== userId) {
      throw new ForbiddenError("Reservation is not yours");
    }

    let checkoutStatus = reservation.status;
    if (
      isHoldingReservationStatus(reservation.status) &&
      reservation.expiresAt !== null &&
      reservation.expiresAt < now
    ) {
      const activePaymentIntents = await tx.paymentIntent.findMany({
        where: {
          reservationId: reservation.id,
          status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
        },
        select: {
          id: true,
          provider: true,
          status: true
        }
      });

      await tx.reservation.update({
        where: { id: reservation.id },
        data: { status: ReservationStatus.expired }
      });

      await tx.paymentIntent.updateMany({
        where: {
          reservationId: reservation.id,
          status: { in: [...ACTIVE_PAYMENT_INTENT_STATUSES] }
        },
        data: {
          status: PaymentIntentStatus.cancelled,
          failureReason: RESERVATION_EXPIRED_REASON
        }
      });

      for (const paymentIntent of activePaymentIntents) {
        await recordPaymentTransaction(tx, {
          reservationId: reservation.id,
          paymentIntentId: paymentIntent.id,
          provider: paymentIntent.provider,
          eventType: "payment_intent.expired",
          paymentIntentStatusBefore: paymentIntent.status,
          paymentIntentStatusAfter: PaymentIntentStatus.cancelled,
          reservationStatusBefore: reservation.status,
          reservationStatusAfter: ReservationStatus.expired,
          failureReason: RESERVATION_EXPIRED_REASON
        });
      }

      checkoutStatus = ReservationStatus.expired;
    }

    const seat = await tx.seat.findUnique({
      where: { id: reservation.seatId },
      select: { code: true }
    });

    if (!seat) {
      throw new NotFoundError("Seat not found");
    }

    const latestPaymentIntent = await tx.paymentIntent.findFirst({
      where: { reservationId: reservation.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true
      }
    });

    return {
      id: reservation.id,
      seatCode: seat.code,
      status: checkoutStatus,
      expiresAt: reservation.expiresAt,
      latestPaymentIntent: latestPaymentIntent ?? undefined
    };
  });
}

export async function createReservationHold(
  userId: string,
  seatId: string
): Promise<ReservationHold> {
  assertUuid(seatId, "seatId");

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await lockSeatForReservation(tx, seatId);

    const blockingReservation = await tx.reservation.findFirst({
      where: {
        seatId,
        ...activeReservationWhere(now)
      },
      select: { id: true }
    });

    if (blockingReservation) {
      throw new ConflictError("Seat is not available");
    }

    const reservation = await tx.reservation.create({
      data: {
        userId,
        seatId,
        status: ReservationStatus.pending_payment,
        expiresAt: addMinutes(now, HOLD_DURATION_MINUTES)
      }
    });

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
      reservationStatusBefore: reservation.status,
      reservationStatusAfter: reservation.status
    });

    return { reservation, paymentIntent };
  });
}

export async function cancelReservation(
  userId: string,
  reservationId: string
): Promise<Reservation> {
  assertUuid(reservationId, "reservationId");

  return prisma.$transaction(async (tx) => {
    const reservation = await lockReservationForUpdate(tx, reservationId);

    if (!reservation) {
      throw new NotFoundError("Reservation not found");
    }

    if (reservation.userId !== userId) {
      throw new ForbiddenError("Reservation is not yours");
    }

    if (
      reservation.status === ReservationStatus.cancelled ||
      reservation.status === ReservationStatus.expired
    ) {
      return reservation;
    }

    if (reservation.status === ReservationStatus.paid) {
      throw new ConflictError("Paid reservation cannot be cancelled");
    }

    if (!isCancellableReservationStatus(reservation.status)) {
      return reservation;
    }

    const cancellablePaymentIntents = await tx.paymentIntent.findMany({
      where: {
        reservationId: reservation.id,
        status: { in: [...CANCELLABLE_PAYMENT_INTENT_STATUSES] }
      },
      select: {
        id: true,
        provider: true,
        status: true
      }
    });

    const cancelledReservation = await tx.reservation.update({
      where: { id: reservation.id },
      data: {
        status: ReservationStatus.cancelled,
        expiresAt: null
      }
    });

    await tx.paymentIntent.updateMany({
      where: {
        reservationId: reservation.id,
        status: { in: [...CANCELLABLE_PAYMENT_INTENT_STATUSES] }
      },
      data: {
        status: PaymentIntentStatus.cancelled,
        failureReason: CANCELLATION_FAILURE_REASON
      }
    });

    for (const paymentIntent of cancellablePaymentIntents) {
      await recordPaymentTransaction(tx, {
        reservationId: reservation.id,
        paymentIntentId: paymentIntent.id,
        provider: paymentIntent.provider,
        eventType: "payment_intent.cancelled",
        paymentIntentStatusBefore: paymentIntent.status,
        paymentIntentStatusAfter: PaymentIntentStatus.cancelled,
        reservationStatusBefore: reservation.status,
        reservationStatusAfter: ReservationStatus.cancelled,
        failureReason: CANCELLATION_FAILURE_REASON
      });
    }

    return cancelledReservation;
  });
}

type LockedReservationRow = {
  id: string;
  userId: string;
  status: ReservationStatus;
  seatId: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function lockReservationForUpdate(
  tx: TransactionClient,
  reservationId: string
): Promise<LockedReservationRow> {
  const rows = await tx.$queryRaw<LockedReservationRow[]>`
    SELECT id, "userId", status, "seatId", "expiresAt", "createdAt", "updatedAt"
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

function activeReservationWhere(now: Date) {
  return {
    OR: [
      { status: ReservationStatus.paid },
      {
        status: { in: [...HOLDING_RESERVATION_STATUSES] },
        expiresAt: { gt: now }
      }
    ]
  };
}

function availabilityFromReservations(
  reservations: BlockingReservation[],
  currentUserId: string
): Omit<SeatWithAvailability, "id" | "code"> {
  const paidReservation = reservations.find(
    (reservation) => reservation.status === ReservationStatus.paid
  );

  if (paidReservation) {
    const reservedByCurrentUser = paidReservation.userId === currentUserId;

    return {
      status: "reserved",
      heldByCurrentUser: false,
      reservedByCurrentUser,
      activeReservationId: reservedByCurrentUser ? paidReservation.id : undefined
    };
  }

  const heldReservation = reservations.find((reservation) =>
    isHoldingReservationStatus(reservation.status)
  );

  if (heldReservation?.expiresAt) {
    const heldByCurrentUser = heldReservation.userId === currentUserId;

    return {
      status: "held",
      heldByCurrentUser,
      reservedByCurrentUser: false,
      activeReservationId: heldByCurrentUser ? heldReservation.id : undefined,
      holdExpiresAt: heldReservation.expiresAt
    };
  }

  return {
    status: "available",
    heldByCurrentUser: false,
    reservedByCurrentUser: false
  };
}

function isCancellableReservationStatus(status: ReservationStatus): boolean {
  return (
    status === ReservationStatus.pending_payment ||
    status === ReservationStatus.payment_failed
  );
}

function isHoldingReservationStatus(status: ReservationStatus): boolean {
  return (
    status === ReservationStatus.pending_payment ||
    status === ReservationStatus.payment_failed
  );
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function assertUuid(value: string, field: string): void {
  if (!uuidSchema.safeParse(value).success) {
    throw new BadRequestError(`Invalid ${field}`);
  }
}
