import { ReservationStatus } from "@/lib/generated/prisma/client";

export const HOLD_DURATION_MINUTES = 10;
export const RESERVATION_EXPIRED_REASON = "Reservation expired";
export const CANCELLATION_FAILURE_REASON = "Reservation cancelled by user";

export const HOLDING_RESERVATION_STATUSES = [
  ReservationStatus.pending_payment,
  ReservationStatus.payment_failed
] as const;

export const PAYABLE_RESERVATION_STATUSES = [
  ReservationStatus.pending_payment,
  ReservationStatus.payment_failed
] as const;
