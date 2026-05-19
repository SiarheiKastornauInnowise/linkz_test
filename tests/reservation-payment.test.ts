import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import {
  PaymentIntentStatus,
  Prisma,
  PrismaClient,
  ReservationStatus,
  type Seat,
  type User
} from "@/lib/generated/prisma/client";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import {
  cancelReservation,
  createReservationHold,
  getReservationCheckoutDetails,
  listSeatsWithAvailability
} from "@/lib/reservation-service";
import {
  completeMockPayment,
  createPaymentIntentForReservation,
  processMockPaymentGatewayEvent
} from "@/lib/payment-service";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

type TestData = {
  users: {
    user1: User;
    user2: User;
  };
  seats: {
    a1: Seat;
    a2: Seat;
    a3: Seat;
  };
};

const testDatabaseUrl = process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  throw new Error("DATABASE_URL is required for integration tests.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: testDatabaseUrl })
});

describe("reservation and payment services", () => {
  let data: TestData;

  beforeAll(async () => {
    await ensureTestDatabase(testDatabaseUrl);
    await resetTestSchema(testDatabaseUrl);
    runMigrations(testDatabaseUrl);
  });

  beforeEach(async () => {
    await resetDatabase();
    data = await seedTestData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows a user to create a pending reservation for an available seat", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    expect(hold.reservation.status).toBe(ReservationStatus.pending_payment);
    expect(hold.reservation.seatId).toBe(data.seats.a1.id);
    expect(hold.paymentIntent.status).toBe(PaymentIntentStatus.requires_payment);
    expect(hold.paymentIntent.reservationId).toBe(hold.reservation.id);
  });

  it("records an audit transaction when a payment intent is created", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const auditRows = await prisma.paymentTransaction.findMany({
      where: { paymentIntentId: hold.paymentIntent.id }
    });

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      reservationId: hold.reservation.id,
      paymentIntentId: hold.paymentIntent.id,
      provider: "mock",
      eventType: "payment_intent.created",
      paymentIntentStatusBefore: null,
      paymentIntentStatusAfter: PaymentIntentStatus.requires_payment,
      reservationStatusBefore: ReservationStatus.pending_payment,
      reservationStatusAfter: ReservationStatus.pending_payment,
      failureReason: null
    });
  });

  it("prevents a second user from reserving the same seat while a hold is active", async () => {
    await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await expect(
      createReservationHold(data.users.user2.id, data.seats.a1.id)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("does not let an expired pending reservation block the seat", async () => {
    await prisma.reservation.create({
      data: {
        userId: data.users.user1.id,
        seatId: data.seats.a1.id,
        status: ReservationStatus.pending_payment,
        expiresAt: minutesFromNow(-1)
      }
    });

    const hold = await createReservationHold(data.users.user2.id, data.seats.a1.id);

    expect(hold.reservation.status).toBe(ReservationStatus.pending_payment);
    expect(hold.reservation.userId).toBe(data.users.user2.id);
  });

  it("marks payment and reservation as failed without clearing expiresAt", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "failure");

    const paymentIntent = await getPaymentIntent(hold.paymentIntent.id);
    const reservation = await getReservation(hold.reservation.id);

    expect(paymentIntent.status).toBe(PaymentIntentStatus.failed);
    expect(reservation.status).toBe(ReservationStatus.payment_failed);
    expect(reservation.expiresAt).not.toBeNull();
  });

  it("records an audit transaction when payment fails", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.failed",
      providerEventId: "evt_payment_failed",
      failureReason: "Gateway declined the payment",
      rawPayload: { id: "evt_payment_failed", type: "payment.failed" }
    });

    const auditRow = await prisma.paymentTransaction.findFirst({
      where: {
        paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.failed"
      }
    });

    expect(auditRow).toMatchObject({
      reservationId: hold.reservation.id,
      paymentIntentId: hold.paymentIntent.id,
      provider: "mock",
      providerEventId: "evt_payment_failed",
      paymentIntentStatusBefore: PaymentIntentStatus.requires_payment,
      paymentIntentStatusAfter: PaymentIntentStatus.failed,
      reservationStatusBefore: ReservationStatus.pending_payment,
      reservationStatusAfter: ReservationStatus.payment_failed,
      failureReason: "Gateway declined the payment",
      rawPayload: { id: "evt_payment_failed", type: "payment.failed" }
    });
  });

  it("keeps a failed payment reservation held until expiresAt", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "failure");

    const seats = await listSeatsWithAvailability(data.users.user1.id);
    const seat = seats.find((item) => item.id === data.seats.a1.id);

    expect(seat?.status).toBe("held");
    expect(seat?.heldByCurrentUser).toBe(true);
    expect(seat?.reservedByCurrentUser).toBe(false);
    expect(seat?.activeReservationId).toBe(hold.reservation.id);
  });

  it("marks the current user's active hold without exposing other users' holds", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const seatsForUser1 = await listSeatsWithAvailability(data.users.user1.id);
    const user1Seat = seatsForUser1.find((item) => item.id === data.seats.a1.id);

    expect(user1Seat?.status).toBe("held");
    expect(user1Seat?.heldByCurrentUser).toBe(true);
    expect(user1Seat?.reservedByCurrentUser).toBe(false);
    expect(user1Seat?.activeReservationId).toBe(hold.reservation.id);

    const seatsForUser2 = await listSeatsWithAvailability(data.users.user2.id);
    const user2Seat = seatsForUser2.find((item) => item.id === data.seats.a1.id);

    expect(user2Seat?.status).toBe("held");
    expect(user2Seat?.heldByCurrentUser).toBe(false);
    expect(user2Seat?.reservedByCurrentUser).toBe(false);
    expect(user2Seat?.activeReservationId).toBeUndefined();
  });

  it("allows retry after a failed payment while the hold is valid", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "failure");

    const retryIntent = await createPaymentIntentForReservation(
      data.users.user1.id,
      hold.reservation.id
    );
    const reservation = await getReservation(hold.reservation.id);

    expect(retryIntent.id).not.toBe(hold.paymentIntent.id);
    expect(retryIntent.status).toBe(PaymentIntentStatus.requires_payment);
    expect(reservation.status).toBe(ReservationStatus.pending_payment);
  });

  it("returns the existing active payment intent instead of creating duplicates", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const sameIntent = await createPaymentIntentForReservation(
      data.users.user1.id,
      hold.reservation.id
    );
    const activeIntents = await prisma.paymentIntent.findMany({
      where: {
        reservationId: hold.reservation.id,
        status: {
          in: [PaymentIntentStatus.requires_payment, PaymentIntentStatus.processing]
        }
      }
    });

    expect(sameIntent.id).toBe(hold.paymentIntent.id);
    expect(activeIntents).toHaveLength(1);
  });

  it("marks a successful retry as paid and clears expiresAt", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "failure");
    const retryIntent = await createPaymentIntentForReservation(
      data.users.user1.id,
      hold.reservation.id
    );

    await completeMockPayment(data.users.user1.id, retryIntent.id, "success");

    const reservation = await getReservation(hold.reservation.id);

    expect(reservation.status).toBe(ReservationStatus.paid);
    expect(reservation.expiresAt).toBeNull();
  });

  it("marks the current user's paid reservation without exposing it to other users", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");

    const seatsForUser1 = await listSeatsWithAvailability(data.users.user1.id);
    const user1Seat = seatsForUser1.find((item) => item.id === data.seats.a1.id);

    expect(user1Seat?.status).toBe("reserved");
    expect(user1Seat?.heldByCurrentUser).toBe(false);
    expect(user1Seat?.reservedByCurrentUser).toBe(true);
    expect(user1Seat?.activeReservationId).toBe(hold.reservation.id);

    const seatsForUser2 = await listSeatsWithAvailability(data.users.user2.id);
    const user2Seat = seatsForUser2.find((item) => item.id === data.seats.a1.id);

    expect(user2Seat?.status).toBe("reserved");
    expect(user2Seat?.heldByCurrentUser).toBe(false);
    expect(user2Seat?.reservedByCurrentUser).toBe(false);
    expect(user2Seat?.activeReservationId).toBeUndefined();
  });

  it("enforces single paid reservation per seat at database level", async () => {
    const firstPaid = await prisma.reservation.create({
      data: {
        userId: data.users.user1.id,
        seatId: data.seats.a1.id,
        status: ReservationStatus.paid,
        expiresAt: null
      }
    });

    await expect(
      prisma.reservation.create({
        data: {
          userId: data.users.user2.id,
          seatId: data.seats.a1.id,
          status: ReservationStatus.paid,
          expiresAt: null
        }
      })
    ).rejects.toMatchObject({
      code: "P2002"
    } satisfies Partial<Prisma.PrismaClientKnownRequestError>);

    expect(firstPaid.status).toBe(ReservationStatus.paid);
  });

  it("treats repeated successful payment completion as idempotent", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");
    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");

    const reservation = await getReservation(hold.reservation.id);

    expect(reservation.status).toBe(ReservationStatus.paid);
  });

  it("records an audit transaction when payment succeeds", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.succeeded",
      providerEventId: "evt_payment_succeeded",
      rawPayload: { id: "evt_payment_succeeded", type: "payment.succeeded" }
    });

    const auditRow = await prisma.paymentTransaction.findFirst({
      where: {
        paymentIntentId: hold.paymentIntent.id,
        eventType: "payment.succeeded"
      }
    });

    expect(auditRow).toMatchObject({
      reservationId: hold.reservation.id,
      paymentIntentId: hold.paymentIntent.id,
      provider: "mock",
      providerEventId: "evt_payment_succeeded",
      paymentIntentStatusBefore: PaymentIntentStatus.requires_payment,
      paymentIntentStatusAfter: PaymentIntentStatus.succeeded,
      reservationStatusBefore: ReservationStatus.pending_payment,
      reservationStatusAfter: ReservationStatus.paid,
      failureReason: null,
      rawPayload: { id: "evt_payment_succeeded", type: "payment.succeeded" }
    });
  });

  it("treats duplicate gateway events as idempotent", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const firstResult = await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.succeeded",
      providerEventId: "evt_duplicate_success"
    });
    const secondResult = await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.succeeded",
      providerEventId: "evt_duplicate_success"
    });

    const auditRows = await prisma.paymentTransaction.findMany({
      where: {
        provider: "mock",
        providerEventId: "evt_duplicate_success"
      }
    });

    expect(firstResult).toEqual(secondResult);
    expect(firstResult.reservationStatus).toBe(ReservationStatus.paid);
    expect(auditRows).toHaveLength(1);
  });

  it("does not let a failed event downgrade an already paid reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.succeeded",
      providerEventId: "evt_paid_before_late_failure"
    });
    await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.failed",
      providerEventId: "evt_late_failure_after_paid",
      failureReason: "Late gateway failure"
    });

    const reservation = await getReservation(hold.reservation.id);
    const paymentIntent = await getPaymentIntent(hold.paymentIntent.id);
    const lateFailureAudit = await prisma.paymentTransaction.findFirst({
      where: {
        provider: "mock",
        providerEventId: "evt_late_failure_after_paid"
      }
    });

    expect(reservation.status).toBe(ReservationStatus.paid);
    expect(reservation.expiresAt).toBeNull();
    expect(paymentIntent.status).toBe(PaymentIntentStatus.succeeded);
    expect(lateFailureAudit).toMatchObject({
      eventType: "payment.failed",
      paymentIntentStatusBefore: PaymentIntentStatus.succeeded,
      paymentIntentStatusAfter: PaymentIntentStatus.succeeded,
      reservationStatusBefore: ReservationStatus.paid,
      reservationStatusAfter: ReservationStatus.paid,
      failureReason: "Late gateway failure"
    });
  });

  it("prevents a user from completing payment for another user's reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await expect(
      completeMockPayment(data.users.user2.id, hold.paymentIntent.id, "success")
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows a user to cancel a pending payment reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const cancelledReservation = await cancelReservation(
      data.users.user1.id,
      hold.reservation.id
    );
    const paymentIntent = await getPaymentIntent(hold.paymentIntent.id);

    expect(cancelledReservation.status).toBe(ReservationStatus.cancelled);
    expect(cancelledReservation.expiresAt).toBeNull();
    expect(paymentIntent.status).toBe(PaymentIntentStatus.cancelled);
  });

  it("does not let a cancelled reservation block the seat", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await cancelReservation(data.users.user1.id, hold.reservation.id);

    const seats = await listSeatsWithAvailability(data.users.user1.id);
    const seat = seats.find((item) => item.id === data.seats.a1.id);

    expect(seat?.status).toBe("available");
    expect(seat?.heldByCurrentUser).toBe(false);
    expect(seat?.reservedByCurrentUser).toBe(false);
    expect(seat?.activeReservationId).toBeUndefined();

    const nextHold = await createReservationHold(data.users.user2.id, data.seats.a1.id);

    expect(nextHold.reservation.status).toBe(ReservationStatus.pending_payment);
    expect(nextHold.reservation.userId).toBe(data.users.user2.id);
  });

  it("prevents a user from cancelling another user's hold", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await expect(
      cancelReservation(data.users.user2.id, hold.reservation.id)
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows a user to cancel a payment_failed reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "failure");

    const reservation = await cancelReservation(
      data.users.user1.id,
      hold.reservation.id
    );

    expect(reservation.status).toBe(ReservationStatus.cancelled);
    expect(reservation.expiresAt).toBeNull();
  });

  it("does not record payment_failed transition for cancelled reservation on late failed event", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await processMockPaymentGatewayEvent({
      paymentIntentId: hold.paymentIntent.id,
      eventType: "payment.failed",
      providerEventId: "evt_failure_before_cancel",
      failureReason: "Initial failure"
    });

    await cancelReservation(data.users.user1.id, hold.reservation.id);

    await expect(
      processMockPaymentGatewayEvent({
        paymentIntentId: hold.paymentIntent.id,
        eventType: "payment.failed",
        providerEventId: "evt_late_failure_after_cancel",
        failureReason: "Late failure after cancel"
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const lateFailureAudit = await prisma.paymentTransaction.findFirst({
      where: {
        provider: "mock",
        providerEventId: "evt_late_failure_after_cancel"
      }
    });

    expect(lateFailureAudit).toBeNull();
  });

  it("does not allow a user to cancel their own paid reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");

    await expect(
      cancelReservation(data.users.user1.id, hold.reservation.id)
    ).rejects.toBeInstanceOf(ConflictError);

    const reservation = await getReservation(hold.reservation.id);
    const paymentIntent = await getPaymentIntent(hold.paymentIntent.id);
    const seats = await listSeatsWithAvailability(data.users.user1.id);
    const seat = seats.find((item) => item.id === data.seats.a1.id);

    expect(reservation.status).toBe(ReservationStatus.paid);
    expect(paymentIntent.status).toBe(PaymentIntentStatus.succeeded);
    expect(seat?.status).toBe("reserved");
    expect(seat?.reservedByCurrentUser).toBe(true);
    expect(seat?.activeReservationId).toBe(hold.reservation.id);
  });

  it("prevents a user from cancelling another user's paid reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");

    await expect(
      cancelReservation(data.users.user2.id, hold.reservation.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    const reservation = await getReservation(hold.reservation.id);

    expect(reservation.status).toBe(ReservationStatus.paid);
  });

  it("rejects repeated cancellation attempts for a paid reservation", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");
    await expect(
      cancelReservation(data.users.user1.id, hold.reservation.id)
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      cancelReservation(data.users.user1.id, hold.reservation.id)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps a paid reservation blocking the seat when cancellation is attempted", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success");
    await expect(
      cancelReservation(data.users.user1.id, hold.reservation.id)
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createReservationHold(data.users.user2.id, data.seats.a1.id)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("prevents a cancelled reservation from later becoming paid", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    await cancelReservation(data.users.user1.id, hold.reservation.id);

    await expect(
      completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success")
    ).rejects.toBeInstanceOf(ConflictError);

    const reservation = await getReservation(hold.reservation.id);

    expect(reservation.status).toBe(ReservationStatus.cancelled);
  });

  it("uses first terminal transition wins for concurrent cancellation and payment completion", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const results = await Promise.allSettled([
      completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success"),
      cancelReservation(data.users.user1.id, hold.reservation.id)
    ]);

    const reservation = await getReservation(hold.reservation.id);
    const fulfilledCount = results.filter((result) => result.status === "fulfilled").length;
    const rejectedCount = results.filter((result) => result.status === "rejected").length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);
    expect([ReservationStatus.paid, ReservationStatus.cancelled]).toContain(
      reservation.status
    );
  });

  it("prevents creating a new hold while payment completion is committing", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);

    const [paymentResult, newHoldResult] = await Promise.allSettled([
      completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "success"),
      createReservationHold(data.users.user2.id, data.seats.a1.id)
    ]);

    const reservation = await getReservation(hold.reservation.id);
    expect(paymentResult.status).toBe("fulfilled");
    expect(newHoldResult.status).toBe("rejected");
    expect(reservation.status).toBe(ReservationStatus.paid);
  });

  it("does not let retry intent creation revive a reservation cancelled concurrently", async () => {
    const hold = await createReservationHold(data.users.user1.id, data.seats.a1.id);
    await completeMockPayment(data.users.user1.id, hold.paymentIntent.id, "failure");

    await Promise.allSettled([
      createPaymentIntentForReservation(data.users.user1.id, hold.reservation.id),
      cancelReservation(data.users.user1.id, hold.reservation.id)
    ]);

    const reservation = await getReservation(hold.reservation.id);
    const paymentIntents = await prisma.paymentIntent.findMany({
      where: { reservationId: hold.reservation.id },
      select: { status: true }
    });
    const activeStatuses: PaymentIntentStatus[] = [
      PaymentIntentStatus.requires_payment,
      PaymentIntentStatus.processing
    ];
    const hasActiveIntent = paymentIntents.some((intent) =>
      activeStatuses.includes(intent.status)
    );

    expect(reservation.status).toBe(ReservationStatus.cancelled);
    expect(hasActiveIntent).toBe(false);
  });

  it("lazily expires an expired pending reservation on checkout details read", async () => {
    const reservation = await prisma.reservation.create({
      data: {
        userId: data.users.user1.id,
        seatId: data.seats.a1.id,
        status: ReservationStatus.pending_payment,
        expiresAt: minutesFromNow(-1)
      }
    });
    const paymentIntent = await prisma.paymentIntent.create({
      data: {
        reservationId: reservation.id,
        provider: "mock",
        status: PaymentIntentStatus.requires_payment
      }
    });

    const details = await getReservationCheckoutDetails(data.users.user1.id, reservation.id);
    const refreshedReservation = await getReservation(reservation.id);
    const refreshedPaymentIntent = await getPaymentIntent(paymentIntent.id);

    expect(details.status).toBe(ReservationStatus.expired);
    expect(refreshedReservation.status).toBe(ReservationStatus.expired);
    expect(refreshedPaymentIntent.status).toBe(PaymentIntentStatus.cancelled);
  });
});

async function resetDatabase(): Promise<void> {
  await prisma.paymentTransaction.deleteMany();
  await prisma.paymentIntent.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.user.deleteMany();
}

async function seedTestData(): Promise<TestData> {
  const [user1, user2] = await Promise.all([
    prisma.user.create({
      data: {
        authProvider: "clerk",
        externalUserId: "test:user1",
        email: "user1@example.com",
        name: "Demo User 1"
      }
    }),
    prisma.user.create({
      data: {
        authProvider: "clerk",
        externalUserId: "test:user2",
        email: "user2@example.com",
        name: "Demo User 2"
      }
    })
  ]);

  const [a1, a2, a3] = await Promise.all([
    prisma.seat.create({ data: { code: "A1" } }),
    prisma.seat.create({ data: { code: "A2" } }),
    prisma.seat.create({ data: { code: "A3" } })
  ]);

  return {
    users: { user1, user2 },
    seats: { a1, a2, a3 }
  };
}

async function getReservation(reservationId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId }
  });

  expect(reservation).not.toBeNull();

  return reservation!;
}

async function getPaymentIntent(paymentIntentId: string) {
  const paymentIntent = await prisma.paymentIntent.findUnique({
    where: { id: paymentIntentId }
  });

  expect(paymentIntent).not.toBeNull();

  return paymentIntent!;
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function ensureTestDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const databaseName = url.pathname.slice(1);

  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL database name must be alphanumeric.");
  }

  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });

  await client.connect();

  try {
    const result = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
      [databaseName]
    );

    if (!result.rows[0]?.exists) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end();
  }
}

async function resetTestSchema(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
}

function runMigrations(connectionString: string): void {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: {
      ...process.env,
      DATABASE_URL: connectionString
    },
    stdio: "inherit"
  });
}
