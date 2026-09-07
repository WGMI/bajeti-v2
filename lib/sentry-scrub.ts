import type { Event } from "@sentry/nextjs";

const REDACTED = "[Filtered]";

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|password|session|jwt|message|transcript|note|sms|amount|balance|account|phone|email/i;

function scrubRecord(record: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!record) return record;

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : value,
    ])
  );
}

function scrubHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return headers;

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : value,
    ])
  );
}

export function scrubSentryEvent<T extends Event>(event: T): T {
  if (event.request) {
    event.request.cookies = undefined;
    event.request.data = REDACTED;
    event.request.headers = scrubHeaders(event.request.headers);
  }

  event.extra = scrubRecord(event.extra);
  event.contexts = scrubRecord(event.contexts as Record<string, unknown> | undefined) as Event["contexts"];
  event.tags = scrubRecord(event.tags as Record<string, unknown> | undefined) as Event["tags"];

  return event;
}
