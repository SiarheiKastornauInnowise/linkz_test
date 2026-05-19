"use client";

import { type CheckoutReservationDto } from "@/types";
import { CheckoutState } from "./CheckoutState";
import { useCheckoutClient } from "./useCheckoutClient";

type CheckoutClientProps = {
  reservation: CheckoutReservationDto;
};

export function CheckoutClient({ reservation }: CheckoutClientProps) {
  const model = useCheckoutClient(reservation);

  return (
    <div className="checkout-view">
      <ReservationSummary
        seatCode={reservation.seatCode}
        statusLabel={model.statusLabel}
        expiresAtLabel={model.expiresAtLabel}
        latestPaymentIntentStatusLabel={model.latestPaymentIntentStatusLabel}
      />
      {model.error ? <p className="form-error">{model.error}</p> : null}
      <CheckoutState
        isBusy={model.isBusy}
        latestPaymentIntentId={model.latestPaymentIntentId}
        onCancel={model.cancelReservation}
        onCompletePayment={model.completePayment}
        onRetry={model.retryPayment}
        paymentFailedRetryUntilLabel={model.paymentFailedRetryUntilLabel}
        pendingAction={model.pendingAction}
        viewState={model.viewState}
      />
    </div>
  );
}

type ReservationSummaryProps = {
  seatCode: string;
  statusLabel: string;
  expiresAtLabel: string | null;
  latestPaymentIntentStatusLabel: string | null;
};

function ReservationSummary({
  seatCode,
  statusLabel,
  expiresAtLabel,
  latestPaymentIntentStatusLabel
}: ReservationSummaryProps) {
  return (
    <div className="detail-panel">
      <div>
        <span className="detail-label">Seat</span>
        <strong>{seatCode}</strong>
      </div>
      <div>
        <span className="detail-label">Reservation status</span>
        <strong>{statusLabel}</strong>
      </div>
      {expiresAtLabel ? (
        <div>
          <span className="detail-label">Expires at</span>
          <strong>{expiresAtLabel}</strong>
        </div>
      ) : null}
      {latestPaymentIntentStatusLabel ? (
        <div>
          <span className="detail-label">Latest payment intent</span>
          <strong>{latestPaymentIntentStatusLabel}</strong>
        </div>
      ) : null}
    </div>
  );
}
