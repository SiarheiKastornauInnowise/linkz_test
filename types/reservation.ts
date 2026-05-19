import {
  PaymentIntentStatus,
  ReservationStatus,
  type PaymentIntent,
  type Reservation
} from "@/lib/generated/prisma/client";

export type SeatAvailabilityStatus = "available" | "held" | "reserved";

export type SeatWithAvailability = {
  id: string;
  code: string;
  status: SeatAvailabilityStatus;
  heldByCurrentUser: boolean;
  reservedByCurrentUser: boolean;
  activeReservationId?: string;
  holdExpiresAt?: Date;
};

export type ReservationHold = {
  reservation: Reservation;
  paymentIntent: PaymentIntent;
};

export type ReservationCheckoutDetails = {
  id: string;
  seatCode: string;
  status: ReservationStatus;
  expiresAt: Date | null;
  latestPaymentIntent?: {
    id: string;
    status: PaymentIntentStatus;
  };
};
