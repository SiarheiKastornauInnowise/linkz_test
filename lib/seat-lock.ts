import { type Prisma } from "@/lib/generated/prisma/client";
import { NotFoundError } from "@/lib/errors";

type TransactionClient = Prisma.TransactionClient;

export async function lockSeatForReservation(
  tx: TransactionClient,
  seatId: string
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtextextended(${seatId}::text, 0))
  `;

  const seat = await tx.seat.findUnique({
    where: { id: seatId },
    select: { id: true }
  });

  if (!seat) {
    throw new NotFoundError("Seat not found");
  }
}
