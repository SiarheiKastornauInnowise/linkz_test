CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('pending_payment', 'payment_failed', 'paid', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('requires_payment', 'processing', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "authProvider" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "seatId" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'pending_payment',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'requires_payment',
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "paymentIntentId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "paymentIntentStatusBefore" "PaymentIntentStatus",
    "paymentIntentStatusAfter" "PaymentIntentStatus" NOT NULL,
    "reservationStatusBefore" "ReservationStatus",
    "reservationStatusAfter" "ReservationStatus",
    "failureReason" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_authProvider_externalUserId_key" ON "users"("authProvider", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "seats_code_key" ON "seats"("code");

-- CreateIndex
CREATE INDEX "reservations_seatId_status_idx" ON "reservations"("seatId", "status");

-- CreateIndex
CREATE INDEX "reservations_userId_idx" ON "reservations"("userId");

-- CreateIndex
CREATE INDEX "reservations_expiresAt_idx" ON "reservations"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_single_paid_per_seat_idx" ON "reservations"("seatId") WHERE "status" = 'paid';

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotencyKey_key" ON "payment_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_intents_reservationId_idx" ON "payment_intents"("reservationId");

-- CreateIndex
CREATE INDEX "payment_intents_idempotencyKey_idx" ON "payment_intents"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_transactions_reservationId_idx" ON "payment_transactions"("reservationId");

-- CreateIndex
CREATE INDEX "payment_transactions_paymentIntentId_idx" ON "payment_transactions"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_providerEventId_key" ON "payment_transactions"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "payment_transactions_eventType_idx" ON "payment_transactions"("eventType");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
