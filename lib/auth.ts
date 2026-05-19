import { auth, currentUser } from "@clerk/nextjs/server";
import { UnauthorizedError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";

const AUTH_PROVIDER = "clerk";

export type CurrentUser = {
  id: string;
  email: string;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();

  if (!session.userId) {
    return null;
  }

  const clerkUser = await currentUser();

  if (!clerkUser || clerkUser.id !== session.userId) {
    return null;
  }

  const primaryEmail = clerkUser.primaryEmailAddress;
  const email = primaryEmail?.emailAddress;

  if (!email) {
    return null;
  }

  const allowEmailLinking = primaryEmail?.verification?.status === "verified";
  const name = displayNameFromClerkUser(clerkUser);

  try {
    return await findOrCreateCurrentUser(clerkUser.id, email, name, allowEmailLinking);
  } catch (error) {
    if (!isUniqueEmailConstraintError(error)) {
      throw error;
    }

    // Concurrent request may create the email record between read and create.
    return findOrCreateCurrentUser(clerkUser.id, email, name, allowEmailLinking);
  }
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();

  if (!user) {
    throw new UnauthorizedError();
  }

  return user;
}

function displayNameFromClerkUser(user: Awaited<ReturnType<typeof currentUser>>): string | null {
  if (!user) {
    return null;
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();

  return fullName || user.username || null;
}

async function findOrCreateCurrentUser(
  externalUserId: string,
  email: string,
  name: string | null,
  allowEmailLinking: boolean
): Promise<CurrentUser | null> {
  return prisma.$transaction(async (tx) => {
    const byExternalId = await tx.user.findUnique({
      where: {
        authProvider_externalUserId: {
          authProvider: AUTH_PROVIDER,
          externalUserId
        }
      },
      select: {
        id: true
      }
    });

    if (byExternalId) {
      return tx.user.update({
        where: { id: byExternalId.id },
        data: { email, name },
        select: { id: true, email: true }
      });
    }

    const byEmail = await tx.user.findUnique({
      where: { email },
      select: { id: true }
    });

    if (byEmail) {
      if (!allowEmailLinking) {
        return null;
      }

      return tx.user.update({
        where: { id: byEmail.id },
        data: {
          authProvider: AUTH_PROVIDER,
          externalUserId,
          email,
          name
        },
        select: { id: true, email: true }
      });
    }

    return tx.user.create({
      data: {
        authProvider: AUTH_PROVIDER,
        externalUserId,
        email,
        name
      },
      select: { id: true, email: true }
    });
  });
}

function isUniqueEmailConstraintError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  return Array.isArray(target) && target.includes("email");
}
