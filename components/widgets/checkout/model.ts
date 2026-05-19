export const CHECKOUT_VIEW_STATE = {
  paid: "paid",
  expired: "expired",
  cancelled: "cancelled",
  paymentFailedRetryable: "payment_failed_retryable",
  paymentFailedFinal: "payment_failed_final",
  pending: "pending"
} as const;

export type CheckoutViewState =
  (typeof CHECKOUT_VIEW_STATE)[keyof typeof CHECKOUT_VIEW_STATE];

export type CheckoutPendingAction =
  | "success"
  | "failure"
  | "retry"
  | "cancel"
  | null;
