"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type InvitePreview = {
  group_name: string;
  currency: string;
  timezone: string;
  role: string;
  status: string;
};

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && typeof data.error === "string" && data.error) || "Request failed");
  }
  return data as T;
}

export default function JoinGroupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinedGroupId, setJoinedGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInvite() {
      try {
        setInvite(await fetchJson<InvitePreview>(`/api/group-invites/${token}`));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load invite");
      } finally {
        setLoading(false);
      }
    }
    loadInvite();
  }, [token]);

  async function acceptInvite() {
    setJoining(true);
    setError(null);
    try {
      const data = await fetchJson<{ ok: true; groupId: string }>(`/api/group-invites/${token}`, {
        method: "POST",
      });
      setJoinedGroupId(data.groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl items-center">
      <div className="w-full rounded-md border bg-background p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            {joinedGroupId ? <Check className="h-5 w-5" /> : <Users className="h-5 w-5" />}
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-normal">
              {joinedGroupId ? "Group joined" : "Join group"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {loading
                ? "Loading invite..."
                : invite
                  ? `${invite.group_name} · ${invite.currency} · ${invite.timezone}`
                  : "Invite unavailable"}
            </p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-md border px-3 py-2 text-sm text-destructive">{error}</p>}

        {invite && !joinedGroupId && (
          <div className="mt-5 space-y-4">
            <p className="text-sm text-muted-foreground">
              You will join as <span className="font-medium text-foreground">{invite.role}</span>.
            </p>
            <Button onClick={acceptInvite} disabled={joining || invite.status !== "pending"}>
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Accept invite
            </Button>
          </div>
        )}

        {joinedGroupId && (
          <div className="mt-5">
            <Button asChild>
              <Link href="/dashboard/groups">Open groups</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
