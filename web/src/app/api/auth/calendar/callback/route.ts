// The old redirect URI, still served.
//
// A redirect URI has to match what is registered in the Google Cloud console character for
// character, so renaming this route would break every deployment whose console still names it
// — including, at the wrong moment, a demo. The handler is the Workspace one, which exchanges
// the code against whatever path Google actually redirected to.

export { GET } from "../../workspace/callback/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
