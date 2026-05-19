"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDateTime, isFutureDate } from "@/helpers/date";
import { readErrorMessage } from "@/helpers/http";
import { formatStatus } from "@/helpers/status";
import { buildAppUrl } from "@/lib/build-app-url";
import { type CheckoutReservationDto } from "@/types";
import { CHECKOUT_ERROR_MESSAGES } from "./messages";
import { CHECKOUT_VIEW_STATE, type CheckoutPendingAction, type CheckoutViewState } from "./model";

type PaymentOutcome = "success" | "failure";

type UseCheckoutClientResult = {
  error: string | null;
  pendingAction: CheckoutPendingAction;
  latestPaymentIntentId?: string;
  isBusy: boolean;
  statusLabel: string;
  expiresAtLabel: string | null;
  latestPaymentIntentStatusLabel: string | null;
  paymentFailedRetryUntilLabel: string | null;
  viewState: CheckoutViewState;
  completePayment: (outcome: PaymentOutcome) => void;
  retryPayment: VoidFunction;
  cancelReservation: VoidFunction;
};

export function useCheckoutClient(
  reservation: CheckoutReservationDto
): UseCheckoutClientResult {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<CheckoutPendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const latestPaymentIntentId = reservation.latestPaymentIntent?.id;

  const viewState = resolveViewState(reservation);

  return {
    error,
    pendingAction,
    latestPaymentIntentId,
    isBusy: pendingAction !== null,
    statusLabel: formatStatus(reservation.status),
    expiresAtLabel: reservation.expiresAt ? formatDateTime(reservation.expiresAt) : null,
    latestPaymentIntentStatusLabel: reservation.latestPaymentIntent
      ? formatStatus(reservation.latestPaymentIntent.status)
      : null,
    paymentFailedRetryUntilLabel:
      viewState === CHECKOUT_VIEW_STATE.paymentFailedRetryable && reservation.expiresAt
        ? formatDateTime(reservation.expiresAt)
        : null,
    viewState,
    completePayment: (outcome) => {
      void completePayment(outcome);
    },
    retryPayment: () => {
      void retryPayment();
    },
    cancelReservation: () => {
      void cancelReservation();
    }
  };

  async function completePayment(outcome: PaymentOutcome) {
    if (!latestPaymentIntentId) {
      setError(CHECKOUT_ERROR_MESSAGES.missingPaymentIntent);
      return;
    }

    setPendingAction(outcome);
    setError(null);

    try {
      const response = await fetch(buildAppUrl("/api/payments/mock-complete"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          paymentIntentId: latestPaymentIntentId,
          outcome
        })
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, CHECKOUT_ERROR_MESSAGES.completePayment));
        router.refresh();
        return;
      }

      if (outcome === "success") {
        router.push(buildAppUrl("/success"));
        return;
      }

      router.refresh();
    } catch {
      setError(CHECKOUT_ERROR_MESSAGES.completePayment);
    } finally {
      setPendingAction(null);
    }
  }

  async function retryPayment() {
    setPendingAction("retry");
    setError(null);

    try {
      const response = await fetch(buildAppUrl("/api/payments/create-intent"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ reservationId: reservation.id })
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, CHECKOUT_ERROR_MESSAGES.createPaymentAttempt));
        router.refresh();
        return;
      }

      router.refresh();
    } catch {
      setError(CHECKOUT_ERROR_MESSAGES.createPaymentAttempt);
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelReservation() {
    setPendingAction("cancel");
    setError(null);

    try {
      const response = await fetch(buildAppUrl(`/api/reservations/${reservation.id}/cancel`), {
        method: "POST"
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, CHECKOUT_ERROR_MESSAGES.cancelReservation));
        router.refresh();
        return;
      }

      router.refresh();
    } catch {
      setError(CHECKOUT_ERROR_MESSAGES.cancelReservation);
    } finally {
      setPendingAction(null);
    }
  }
}

function resolveViewState(reservation: CheckoutReservationDto): CheckoutViewState {
  if (reservation.status === "paid") {
    return CHECKOUT_VIEW_STATE.paid;
  }

  if (reservation.status === "expired") {
    return CHECKOUT_VIEW_STATE.expired;
  }

  if (reservation.status === "cancelled") {
    return CHECKOUT_VIEW_STATE.cancelled;
  }

  if (reservation.status === "payment_failed") {
    if (reservation.expiresAt && isFutureDate(reservation.expiresAt)) {
      return CHECKOUT_VIEW_STATE.paymentFailedRetryable;
    }

    return CHECKOUT_VIEW_STATE.paymentFailedFinal;
  }

  return CHECKOUT_VIEW_STATE.pending;
}
