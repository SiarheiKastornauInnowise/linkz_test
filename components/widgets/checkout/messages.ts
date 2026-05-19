export const CHECKOUT_ERROR_MESSAGES = {
  missingPaymentIntent: "No payment intent is available for this reservation.",
  completePayment: "Could not complete payment. Please try again.",
  createPaymentAttempt: "Could not create a new payment attempt. Please try again.",
  cancelReservation: "Could not cancel reservation. Please try again."
} as const;
