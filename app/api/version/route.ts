import { NextResponse } from "next/server";

/**
 * TASK-16: the deployed revision, so a remote smoke can tell "the deploy
 * worked" from "the deploy failed and the previous revision is still
 * serving". Every other smoke check passes identically in both cases.
 *
 * `VERCEL_GIT_COMMIT_SHA` is injected by Vercel itself; `APP_REVISION` is the
 * fallback for any environment that does not inject it. Neither being set is
 * normal in local development, and the route reports `null` rather than
 * inventing a value — the smoke decides whether an absent revision is a
 * failure, which it is exactly when an expected revision was supplied.
 */
export const dynamic = "force-dynamic";

export function GET() {
  const revision = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.APP_REVISION ?? null;

  return NextResponse.json({ revision });
}
