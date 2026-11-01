import { clerkSetup } from "@clerk/testing/playwright";
import { FullConfig } from "@playwright/test";

export default async function globalSetup(_config: FullConfig) {
  const letters = "ABCDEFGHIJKLMNOP".split("");
  const required = letters.flatMap((l) => [`E2E_USER_${l}_EMAIL`, `E2E_USER_${l}_PASSWORD`]);
  // E2E_PUBLIC_ONLY=1 runs only the signed-out specs (no Clerk test users needed).
  if (process.env.E2E_PUBLIC_ONLY === "1") {
    if (process.env.CLERK_SECRET_KEY) await clerkSetup();
    return;
  }
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required env var: ${key}. Create apps/web/.env.test with test credentials.`);
    }
  }
  await clerkSetup();
}
