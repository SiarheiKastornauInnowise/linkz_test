import { CheckoutActionState } from "./CheckoutActionState";
import { CheckoutTerminalState } from "./CheckoutTerminalState";
import { CHECKOUT_VIEW_STATE, type CheckoutPendingAction, type CheckoutViewState } from "./model";

type CheckoutStateProps = {
  viewState: CheckoutViewState;
  paymentFailedRetryUntilLabel: string | null;
  isBusy: boolean;
  latestPaymentIntentId?: string;
  pendingAction: CheckoutPendingAction;
  onCompletePayment: (outcome: "success" | "failure") => void;
  onRetry: VoidFunction;
  onCancel: VoidFunction;
};

export function CheckoutState({
  viewState,
  paymentFailedRetryUntilLabel,
  isBusy,
  latestPaymentIntentId,
  pendingAction,
  onCompletePayment,
  onRetry,
  onCancel
}: CheckoutStateProps) {
  if (
    viewState === CHECKOUT_VIEW_STATE.paymentFailedRetryable ||
    viewState === CHECKOUT_VIEW_STATE.pending
  ) {
    return (
      <CheckoutActionState
        isBusy={isBusy}
        latestPaymentIntentId={latestPaymentIntentId}
        onCancel={onCancel}
        onCompletePayment={onCompletePayment}
        onRetry={onRetry}
        paymentFailedRetryUntilLabel={paymentFailedRetryUntilLabel}
        pendingAction={pendingAction}
        viewState={viewState}
      />
    );
  }

  return <CheckoutTerminalState viewState={viewState} />;
}
