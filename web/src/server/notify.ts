import "server-only";

// Push. The channel that actually reaches a person standing in a workshop.
//
// Two things make this different from the calendar half: it works for a task nobody owns yet
// (a role is a queue, and a queue notifies everyone holding the role), and it must never be
// suppressed by a calendar failure. A missed event is an inconvenience; a missed escalation
// is a machine released that should not have been.

import { getMessaging } from "firebase-admin/messaging";
import { adminApp, adminDb } from "@/auth/admin";
import { membersWithRole, type Role } from "@/auth/members";

export interface DeviceDoc {
  uid: string;
  fcm_token: string;
  platform: "android" | "web";
  app_version: string | null;
  last_seen_at: string;
}

const devicesCol = (tenantId: string) =>
  adminDb().collection("tenants").doc(tenantId).collection("devices");

/**
 * Devices belong at the top level under the tenant, not inside `members`.
 *
 * `members` is server-written, and refreshing an FCM token is a legitimate client act. The
 * general pattern: when part of a concept must be client-writable, it becomes its own
 * collection rather than a subcollection of a protected one.
 */
export async function devicesFor(tenantId: string, uids: string[]): Promise<DeviceDoc[]> {
  if (uids.length === 0) return [];
  const out: DeviceDoc[] = [];
  // `in` takes at most 30 values, and a workshop has fewer people than that — but chunking
  // costs two lines and removes a cliff nobody would see coming.
  for (let i = 0; i < uids.length; i += 30) {
    const snap = await devicesCol(tenantId).where("uid", "in", uids.slice(i, i + 30)).get();
    out.push(...snap.docs.map((d) => d.data() as DeviceDoc));
  }
  return out;
}

export interface PushInput {
  tenantId: string;
  title: string;
  body: string;
  taskId: string;
  assigneeUid: string | null;
  assigneeRole: Role | null;
}

/**
 * Send to the owner, or to everyone who could become one.
 *
 * Returns how many devices were reached, which is what the sweep logs. Zero is not an error:
 * a technician who has never opened the app has no device registered, and the task is still
 * waiting for them in the queue.
 */
export async function pushTask(input: PushInput): Promise<number> {
  const uids = input.assigneeUid
    ? [input.assigneeUid]
    : input.assigneeRole
      ? (await membersWithRole(input.tenantId, input.assigneeRole)).map((m) => m.uid)
      : [];

  const devices = await devicesFor(input.tenantId, uids);
  if (devices.length === 0) return 0;

  try {
    const response = await getMessaging(adminApp()).sendEachForMulticast({
      tokens: devices.map((d) => d.fcm_token),
      notification: { title: input.title, body: input.body },
      data: { warrant_task_id: input.taskId, tenant_id: input.tenantId },
    });

    // A token goes stale when the app is reinstalled. Leaving dead tokens in place means
    // every future sweep pays for them, so they are pruned on the failure that reveals them.
    await Promise.all(
      response.responses.map(async (r, i) => {
        const code = r.error?.code;
        if (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token") {
          await devicesCol(input.tenantId)
            .where("fcm_token", "==", devices[i].fcm_token)
            .get()
            .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
        }
      }),
    );

    return response.successCount;
  } catch {
    // No messaging configured, or no network. The task stays open and the next sweep retries.
    return 0;
  }
}
