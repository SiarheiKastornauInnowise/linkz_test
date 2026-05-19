"use client";

import { type SeatItemDto } from "@/types";
import { useSeatsClient } from "./useSeatsClient";

type SeatsClientProps = {
  seats: SeatItemDto[];
};

export function SeatsClient({ seats }: SeatsClientProps) {
  const { error, seatItems, onSeatAction } = useSeatsClient(seats);

  return (
    <div className="seats-view">
      {error ? <p className="form-error">{error}</p> : null}
      <ul className="seat-list" aria-label="Available seats">
        {seatItems.map((seat) => {
          return (
            <li className="seat-row" key={seat.id}>
              <div>
                <div className="seat-code">{seat.code}</div>
                <div className={`seat-status seat-status-${seat.status}`}>
                  {seat.status}
                </div>
                {seat.note ? <div className="seat-note">{seat.note}</div> : null}
              </div>
              <button
                className={
                  seat.action.variant === "primary"
                    ? "button-link"
                    : "secondary-button"
                }
                disabled={seat.action.disabled}
                onClick={() => onSeatAction(seat)}
                type="button"
              >
                {seat.action.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
