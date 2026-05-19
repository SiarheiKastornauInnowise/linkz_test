import {
  PaymentIntentStatus,
  ReservationStatus
} from "@/lib/generated/prisma/client";
import { type SeatAvailabilityStatus } from "@/types/reservation";

export type CheckoutReservationDto = {
  id: string;
  seatCode: string;
  status: ReservationStatus;
  expiresAt: string | null;
  latestPaymentIntent?: {
    id: string;
    status: PaymentIntentStatus;
  };
};

export type SeatItemDto = {
  id: string;
  code: string;
  status: SeatAvailabilityStatus;
  heldByCurrentUser: boolean;
  reservedByCurrentUser: boolean;
  activeReservationId?: string;
  holdExpiresAt?: string;
};

export type CreateReservationResponseDto = {
  reservationId: string;
};
