// The calendar link, as it was before Warrant used three Google APIs.
//
// Kept as an alias rather than deleted. The grant is now one Workspace consent covering the
// calendar, Gmail drafts and Drive — see /api/auth/workspace — but this path is what an
// already-deployed build and any bookmarked link still call, and a 404 there looks like the
// calendar feature was removed.

export { GET, DELETE } from "../workspace/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
