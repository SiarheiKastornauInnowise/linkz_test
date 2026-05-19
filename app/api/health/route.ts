import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { prisma } = await import("@/lib/prisma");

    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({
      status: "ok",
      database: "ok"
    });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        database: "error"
      },
      { status: 503 }
    );
  }
}
