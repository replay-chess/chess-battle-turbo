import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export interface ApiKeyValidationResult {
  valid: boolean;
  error?: NextResponse;
}

/**
 * Validates the X-API-Key header against the configured scraper API key.
 * Returns a structured result indicating validity or an error response.
 */
export function validateScraperApiKey(
  request: NextRequest
): ApiKeyValidationResult {
  const apiKey = request.headers.get("X-API-Key");
  const expectedKey = process.env.SCRAPER_API_KEY;

  if (!expectedKey) {
    logger.error("SCRAPER_API_KEY environment variable is not configured");
    return {
      valid: false,
      error: NextResponse.json(
        { error: "API key authentication not configured on server" },
        { status: 500 }
      ),
    };
  }

  if (!apiKey) {
    return {
      valid: false,
      error: NextResponse.json(
        { error: "Missing X-API-Key header" },
        { status: 401 }
      ),
    };
  }

  if (apiKey !== expectedKey) {
    return {
      valid: false,
      error: NextResponse.json({ error: "Invalid API key" }, { status: 403 }),
    };
  }

  return { valid: true };
}
