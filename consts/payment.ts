import { PaymentIntentStatus } from "@/lib/generated/prisma/client";

export const PAYMENT_PROVIDER = "mock";
export const MOCK_PAYMENT_FAILED_REASON = "Mock payment failed";

export const ACTIVE_PAYMENT_INTENT_STATUSES = [
  PaymentIntentStatus.requires_payment,
  PaymentIntentStatus.processing
] as const;

export const CANCELLABLE_PAYMENT_INTENT_STATUSES = [
  PaymentIntentStatus.requires_payment,
  PaymentIntentStatus.processing
] as const;
