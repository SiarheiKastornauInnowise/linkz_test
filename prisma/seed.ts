import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

async function main() {
  const seatCodes = ["A1", "A2", "A3"];
  const users = [
    {
      authProvider: "clerk",
      externalUserId: "seed:user1",
      email: "user1@example.com",
      name: "Demo User 1"
    },
    {
      authProvider: "clerk",
      externalUserId: "seed:user2",
      email: "user2@example.com",
      name: "Demo User 2"
    }
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: {
        authProvider_externalUserId: {
          authProvider: user.authProvider,
          externalUserId: user.externalUserId
        }
      },
      update: { email: user.email, name: user.name },
      create: user
    });
  }

  for (const code of seatCodes) {
    await prisma.seat.upsert({
      where: { code },
      update: {},
      create: { code }
    });
  }

  await prisma.seat.deleteMany({
    where: {
      code: {
        notIn: seatCodes
      }
    }
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
