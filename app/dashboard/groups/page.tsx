"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, Link as LinkIcon, Plus, RefreshCw, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CURRENCY_OPTIONS, type CurrencyCode } from "@/lib/settings-store";
import { useSettings } from "@/lib/settings-store";

type GroupSummary = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: string;
  memberCount: number;
  pendingInvites: number;
  createdAt: string;
};

type GroupDetail = {
  group: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    invite_token: string;
  };
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    display_name: string | null;
    email: string | null;
    joined_at: string;
  }>;
  invites: Array<{
    id: string;
    email: string | null;
    role: string;
    token: string;
    status: string;
    created_at: string;
  }>;
  auditEvents: Array<{
    id: string;
    actor_user_id: string;
    entity_type: string;
    action: string;
    created_at: string;
  }>;
  transactionsByMember: Array<{
    user_id: string;
    transaction_count: number;
  }>;
};

const roles = ["admin", "accountant", "contributor", "viewer"] as const;

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

export default function GroupsPage() {
  const settings = useSettings();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState("Africa/Nairobi");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<(typeof roles)[number]>("viewer");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null,
    [groups, selectedGroupId]
  );

  async function loadGroups() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ groups: GroupSummary[] }>("/api/groups");
      setGroups(data.groups);
      setSelectedGroupId((current) => current ?? data.groups[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(groupId: string) {
    try {
      const data = await fetchJson<GroupDetail>(`/api/groups/${groupId}`);
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load group");
    }
  }

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    setCurrency((current) => current || settings.currency);
  }, [settings.currency]);

  useEffect(() => {
    if (selectedGroup?.id) {
      loadDetail(selectedGroup.id);
    } else {
      setDetail(null);
    }
  }, [selectedGroup?.id]);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const created = await fetchJson<GroupSummary>("/api/groups", {
        method: "POST",
        body: JSON.stringify({ name, currency, timezone }),
      });
      setGroups((prev) => [created, ...prev]);
      setSelectedGroupId(created.id);
      setName("");
      setMessage(`${created.name} group created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setSaving(false);
    }
  }

  async function inviteMember(event: FormEvent) {
    event.preventDefault();
    if (!selectedGroup) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await fetchJson(`/api/groups/${selectedGroup.id}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail("");
      setMessage(`Invite sent to ${inviteEmail}.`);
      await loadGroups();
      await loadDetail(selectedGroup.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setSaving(false);
    }
  }

  const inviteLink =
    detail?.group.invite_token && typeof window !== "undefined"
      ? `${window.location.origin}/dashboard/groups/join/${detail.group.invite_token}`
      : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Groups</h1>
          <p className="text-sm text-muted-foreground">
            Shared Bajetis for families, chamas, committees, and audited team spending.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadGroups} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {(error || message) && (
        <div className="rounded-md border bg-background px-3 py-2 text-sm">
          {error ? <span className="text-destructive">{error}</span> : message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <section className="space-y-4">
          <form onSubmit={createGroup} className="space-y-4 rounded-md border bg-background p-4">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium">Create group</h2>
            </div>
            <div className="space-y-2">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Holiday fund"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="group-currency">Currency</Label>
                <Select
                  value={currency}
                  onValueChange={(value) => setCurrency(value as CurrencyCode)}
                >
                  <SelectTrigger id="group-currency">{currency}</SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="group-timezone">Timezone</Label>
                <Input
                  id="group-timezone"
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              <Plus className="h-4 w-4" />
              Create group
            </Button>
          </form>

          <div className="space-y-3">
            {groups.length === 0 && !loading ? (
              <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">
                No groups yet.
              </div>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full rounded-md border bg-background p-4 text-left transition-colors hover:bg-muted/40 ${
                    selectedGroup?.id === group.id ? "border-primary" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{group.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {group.currency} · {group.timezone}
                      </p>
                    </div>
                    <Badge variant="secondary">{group.role}</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{group.memberCount} members</span>
                    <span>{group.pendingInvites} pending invites</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-md border bg-background p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-medium">{selectedGroup?.name ?? "Selected group"}</h2>
            </div>
            {detail ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Members</p>
                  <p className="text-xl font-semibold">{detail.members.length}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Pending invites</p>
                  <p className="text-xl font-semibold">
                    {detail.invites.filter((invite) => invite.status === "pending").length}
                  </p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Audit events</p>
                  <p className="text-xl font-semibold">{detail.auditEvents.length}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Choose or create a group.</p>
            )}
          </div>

          {detail && (
            <>
              <form onSubmit={inviteMember} className="space-y-4 rounded-md border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-medium">Invite member</h2>
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="grace@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <Select
                      value={inviteRole}
                      onValueChange={(value) => setInviteRole(value as (typeof roles)[number])}
                    >
                      <SelectTrigger id="invite-role">{inviteRole}</SelectTrigger>
                      <SelectContent>
                        {roles.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving}>
                    <Send className="h-4 w-4" />
                    Send invite
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!inviteLink}
                    onClick={() => inviteLink && navigator.clipboard.writeText(inviteLink)}
                  >
                    <Copy className="h-4 w-4" />
                    Copy link
                  </Button>
                </div>
              </form>

              <div className="rounded-md border bg-background p-4">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-medium">Members</h2>
                </div>
                <div className="mt-3 divide-y">
                  {detail.members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member.display_name || member.email || member.user_id}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{member.user_id}</p>
                      </div>
                      <Badge variant="outline">{member.role}</Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-md border bg-background p-4">
                <h2 className="font-medium">Recent audit trail</h2>
                <div className="mt-3 divide-y">
                  {detail.auditEvents.length === 0 ? (
                    <p className="py-3 text-sm text-muted-foreground">No audit events yet.</p>
                  ) : (
                    detail.auditEvents.slice(0, 8).map((event) => (
                      <div key={event.id} className="py-3 text-sm">
                        <p className="font-medium">
                          {event.entity_type} {event.action}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {event.actor_user_id} · {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
