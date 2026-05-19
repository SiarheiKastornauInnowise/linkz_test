import Link from "next/link";
import { CHECKOUT_VIEW_STATE, type CheckoutViewState } from "./model";

type TerminalViewState = Exclude<
  CheckoutViewState,
  | typeof CHECKOUT_VIEW_STATE.pending
  | typeof CHECKOUT_VIEW_STATE.paymentFailedRetryable
>;

type CheckoutTerminalStateProps = {
  viewState: TerminalViewState;
};

const TERMINAL_STATE_CONTENT: Record<
  TerminalViewState,
  {
    title: string;
    description: string;
    href: string;
    actionLabel: string;
  }
> = {
  [CHECKOUT_VIEW_STATE.paid]: {
    title: "Payment complete",
    description: "Your reservation is confirmed.",
    href: "/success",
    actionLabel: "Continue"
  },
  [CHECKOUT_VIEW_STATE.expired]: {
    title: "Reservation expired",
    description: "This hold is no longer active.",
    href: "/seats",
    actionLabel: "Back to seats"
  },
  [CHECKOUT_VIEW_STATE.cancelled]: {
    title: "Reservation cancelled",
    description: "Reservation cancelled. The seat is now available again.",
    href: "/seats",
    actionLabel: "Back to seats"
  },
  [CHECKOUT_VIEW_STATE.paymentFailedFinal]: {
    title: "Payment failed",
    description: "This payment attempt can no longer be retried.",
    href: "/seats",
    actionLabel: "Back to seats"
  }
};

export function CheckoutTerminalState({ viewState }: CheckoutTerminalStateProps) {
  const content = TERMINAL_STATE_CONTENT[viewState];

  return (
    <div className="checkout-state">
      <h2>{content.title}</h2>
      <p>{content.description}</p>
      <Link className="button-link" href={content.href}>
        {content.actionLabel}
      </Link>
    </div>
  );
}
