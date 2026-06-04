import { NextResponse } from "next/server";

/** Prevent Vercel CDN from caching API responses (including error pages). */
export const API_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;

export function apiJson<T>(body: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(API_NO_STORE_HEADERS)) {
    headers.set(key, value);
  }
  return NextResponse.json(body, { ...init, headers });
}
