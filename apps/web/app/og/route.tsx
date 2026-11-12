// The generic social card (`/og?title=&subtitle=&type=`). Its design and helpers live in lib/og (phase-03 plan §3.2),
// shared with the share image `/r/<code>/og`, which falls back to this same card for a revoked, expired or unknown link.
import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { genericCard } from "@/lib/og/cards";
import { genericCardInput, OG_HEIGHT, OG_WIDTH } from "@/lib/og/theme";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const input = genericCardInput({
    title: searchParams.get("title"),
    subtitle: searchParams.get("subtitle"),
    type: searchParams.get("type"),
  });
  return new ImageResponse(genericCard(input), { width: OG_WIDTH, height: OG_HEIGHT });
}
