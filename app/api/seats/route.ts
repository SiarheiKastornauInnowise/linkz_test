import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { errorToResponse } from "@/lib/errors";
import { listSeatsWithAvailability } from "@/lib/reservation-service";

export async function GET() {
  try {
    const currentUser = await requireCurrentUser();

    const seats = await listSeatsWithAvailability(currentUser.id);

    return NextResponse.json({ seats });
  } catch (error: unknown) {
    return errorToResponse(error);
  }
}
