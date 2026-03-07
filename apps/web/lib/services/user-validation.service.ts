import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";

/**
 * Validate user exists and is active
 */
export async function validateAndFetchUser(userReferenceId: string) {
  const user = await prisma.user.findUnique({
    where: { referenceId: userReferenceId },
  });

  if (!user) {
    throw new ValidationError("User not found", 404);
  }

  if (!user.isActive) {
    throw new ValidationError("User account is not active", 400);
  }

  return user;
}
