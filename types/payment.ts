import {
  PaymentIntentStatus,
  ReservationStatus,
  type Prisma
} from "@/lib/generated/prisma/client";

export type MockPaymentOutcome = "success" | "failure";
export type MockPaymentGatewayEventType = "payment.succeeded" | "payment.failed";
export type MockPaymentResultStatus =
  | typeof ReservationStatus.paid
  | typeof ReservationStatus.payment_failed;

export type MockPaymentResult = {
  reservationId: string;
  reservationStatus: MockPaymentResultStatus;
  paymentIntentStatus: PaymentIntentStatus;
};

export type ProcessMockPaymentGatewayEventInput = {
  paymentIntentId: string;
  eventType: MockPaymentGatewayEventType;
  providerEventId: string;
  failureReason?: string;
  rawPayload?: Prisma.InputJsonValue;
  actingUserId?: string;
};
