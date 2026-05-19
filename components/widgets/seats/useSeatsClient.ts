"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatTime } from "@/helpers/date";
import { readErrorMessage } from "@/helpers/http";
import { buildAppUrl } from "@/lib/build-app-url";
import {
  type CreateReservationResponseDto,
  type SeatItemDto
} from "@/types";
import { SEATS_ERROR_MESSAGES } from "./messages";

type SeatAction = {
  type: "select" | "cancel" | "none";
  label: string;
  disabled: boolean;
  variant: "primary" | "secondary";
};

type SeatViewModel = {
  id: string;
  code: string;
  status: SeatItemDto["status"];
  note: string | null;
  action: SeatAction;
};

type UseSeatsClientResult = {
  error: string | null;
  seatItems: SeatViewModel[];
  onSeatAction: (seat: SeatViewModel) => void;
};

export function useSeatsClient(seats: SeatItemDto[]): UseSeatsClientResult {
  const router = useRouter();
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [cancellingReservationId, setCancellingReservationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  function onSeatAction(seat: SeatViewModel) {
    if (seat.action.type === "select") {
      void handleSelectSeat(seat.id);
      return;
    }

    if (seat.action.type === "cancel") {
      const activeReservationId = seats.find((item) => item.id === seat.id)?.activeReservationId;

      if (activeReservationId) {
        void handleCancelReservation(activeReservationId);
      }
    }
  }

  const seatItems = seats.map((seat) => {
    const isSelecting = selectedSeatId === seat.id;
    const isCancelling = seat.activeReservationId === cancellingReservationId;

    return {
      id: seat.id,
      code: seat.code,
      status: seat.status,
      note: getSeatNote(seat),
      action: getSeatAction(seat, isSelecting, isCancelling)
    };
  });

  return {
    error,
    seatItems,
    onSeatAction
  };

  async function handleSelectSeat(seatId: string) {
    setSelectedSeatId(seatId);
    setError(null);

    try {
      const response = await fetch(buildAppUrl("/api/reservations"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ seatId })
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, SEATS_ERROR_MESSAGES.createReservation));
        router.refresh();
        return;
      }

      const reservation = (await response.json()) as CreateReservationResponseDto;
      router.push(buildAppUrl(`/checkout/${reservation.reservationId}`));
    } catch {
      setError(SEATS_ERROR_MESSAGES.createReservation);
    } finally {
      setSelectedSeatId(null);
    }
  }

  async function handleCancelReservation(reservationId: string) {
    setCancellingReservationId(reservationId);
    setError(null);

    try {
      const response = await fetch(buildAppUrl(`/api/reservations/${reservationId}/cancel`), {
        method: "POST"
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, SEATS_ERROR_MESSAGES.cancelReservation));
        router.refresh();
        return;
      }

      router.refresh();
    } catch {
      setError(SEATS_ERROR_MESSAGES.cancelReservation);
    } finally {
      setCancellingReservationId(null);
    }
  }
}

function getSeatAction(
  seat: SeatItemDto,
  isSelecting: boolean,
  isCancelling: boolean
): SeatAction {
  if (seat.status === "available") {
    return {
      type: "select",
      label: isSelecting ? "Selecting..." : "Select seat",
      disabled: isSelecting,
      variant: "primary"
    };
  }

  if (seat.status === "held" && seat.heldByCurrentUser) {
    return {
      type: "cancel",
      label: isCancelling ? "Cancelling..." : "Cancel reservation",
      disabled: isCancelling || !seat.activeReservationId,
      variant: "secondary"
    };
  }

  if (seat.status === "held") {
    return {
      type: "none",
      label: "Held",
      disabled: true,
      variant: "secondary"
    };
  }

  if (seat.status === "reserved" && seat.reservedByCurrentUser) {
    return {
      type: "cancel",
      label: isCancelling ? "Cancelling..." : "Cancel reservation",
      disabled: isCancelling || !seat.activeReservationId,
      variant: "secondary"
    };
  }

  return {
    type: "none",
    label: "Reserved",
    disabled: true,
    variant: "secondary"
  };
}

function getSeatNote(seat: SeatItemDto): string | null {
  if (seat.status === "held" && seat.holdExpiresAt) {
    const ownerLabel = seat.heldByCurrentUser ? "Held by you" : "Held";
    return `${ownerLabel} until ${formatTime(seat.holdExpiresAt)}`;
  }

  if (seat.status === "reserved" && seat.reservedByCurrentUser) {
    return "Reserved by you";
  }

  return null;
}
