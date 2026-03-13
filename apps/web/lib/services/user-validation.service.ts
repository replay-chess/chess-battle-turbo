import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors/validation-error";

const DEMO_USER_CODE = "DEMO_PLAYER_001";

/**
 * Validate user exists and is active.
 * Blocks the demo system user from being used on non-demo endpoints.
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

  if (user.code === DEMO_USER_CODE) {
    throw new ValidationError("Demo accounts cannot use this endpoint", 403);
  }

  return user;
}
