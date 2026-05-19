import { PrismaPg } from "@prisma/adapter-pg";
import {
  PaymentIntentStatus,
  PrismaClient,
  ReservationStatus
} from "@/lib/generated/prisma/client";
import { recordPaymentTransaction } from "@/lib/payment-audit";
import {
  ACTIVE_PAYMENT_INTENT_STATUSES,
  HOLDING_RESERVATION_STATUSES,
  RESERVATION_EXPIRED_REASON
} from "@/consts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to clean up expired reservations.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

async function main(): Promise<void> {
  const now = new Date();

  const expiredReservationIds = await prisma.$transaction(async (tx) => {
    const expiredReservations = await tx.reservation.findMany({
      where: {
        status: {
          in: [...HOLDING_RESERVATION_STATUSES]
        },
        expiresAt: {
          lt: now
        }
      },
      select: {
        id: true,
        status: true,
        paymentIntents: {
          where: {
            status: {
              in: [...ACTIVE_PAYMENT_INTENT_STATUSES]
            }
          },
          select: {
            id: true,
            provider: true,
            status: true
          }
        }
      }
    });
    const reservationIds = expiredReservations.map((reservation) => reservation.id);

    if (reservationIds.length === 0) {
      return reservationIds;
    }

    await tx.reservation.updateMany({
      where: {
        id: {
          in: reservationIds
        },
        status: {
          in: [...HOLDING_RESERVATION_STATUSES]
        },
        expiresAt: {
          lt: now
        }
      },
      data: {
        status: ReservationStatus.expired
      }
    });

    await tx.paymentIntent.updateMany({
      where: {
        reservationId: {
          in: reservationIds
        },
        status: {
          in: [...ACTIVE_PAYMENT_INTENT_STATUSES]
        }
      },
      data: {
        status: PaymentIntentStatus.cancelled,
        failureReason: RESERVATION_EXPIRED_REASON
      }
    });

    for (const reservation of expiredReservations) {
      for (const paymentIntent of reservation.paymentIntents) {
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
    }

    return reservationIds;
  });

  console.log(`Expired reservations cleaned up: ${expiredReservationIds.length}`);
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
