import { CHECKOUT_VIEW_STATE } from "./model";

type CheckoutActionStateProps = {
  viewState:
    | typeof CHECKOUT_VIEW_STATE.pending
    | typeof CHECKOUT_VIEW_STATE.paymentFailedRetryable;
  paymentFailedRetryUntilLabel: string | null;
  isBusy: boolean;
  latestPaymentIntentId?: string;
  pendingAction: "success" | "failure" | "retry" | "cancel" | null;
  onCompletePayment: (outcome: "success" | "failure") => void;
  onRetry: VoidFunction;
  onCancel: VoidFunction;
};

export function CheckoutActionState({
  viewState,
  paymentFailedRetryUntilLabel,
  isBusy,
  latestPaymentIntentId,
  pendingAction,
  onCompletePayment,
  onRetry,
  onCancel
}: CheckoutActionStateProps) {
  if (viewState === CHECKOUT_VIEW_STATE.paymentFailedRetryable) {
    return (
      <div className="checkout-state">
        <p>Payment failed. You can retry until {paymentFailedRetryUntilLabel}.</p>
        <div className="action-row">
          <button
            className="button-link"
            disabled={isBusy}
            onClick={onRetry}
            type="button"
          >
            {pendingAction === "retry" ? "Retrying..." : "Retry payment"}
          </button>
          <button
            className="secondary-button"
            disabled={isBusy}
            onClick={onCancel}
            type="button"
          >
            {pendingAction === "cancel" ? "Cancelling..." : "Cancel reservation"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="checkout-state">
      <p>Complete the mock payment to confirm this reservation.</p>
      <div className="action-row">
        <button
          className="button-link"
          disabled={isBusy || !latestPaymentIntentId}
          onClick={() => onCompletePayment("success")}
          type="button"
        >
          {pendingAction === "success" ? "Processing..." : "Pay successfully"}
        </button>
        <button
          className="secondary-button"
          disabled={isBusy || !latestPaymentIntentId}
          onClick={() => onCompletePayment("failure")}
          type="button"
        >
          {pendingAction === "failure" ? "Processing..." : "Fail payment"}
        </button>
        <button
          className="secondary-button"
          disabled={isBusy}
          onClick={onCancel}
          type="button"
        >
          {pendingAction === "cancel" ? "Cancelling..." : "Cancel reservation"}
        </button>
      </div>
    </div>
  );
}
