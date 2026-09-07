import * as Sentry from "@sentry/nextjs";

type SafeContextValue = string | number | boolean | null | undefined;

type SafeContext = Record<string, SafeContextValue>;

const SENSITIVE_CONTEXT_KEY_PATTERN =
  /authorization|cookie|token|secret|password|session|jwt|message|transcript|note|sms|amount|balance|account|phone|email/i;

function applySafeContext(scope: Sentry.Scope, route: string, context: SafeContext) {
  scope.setTag("surface", "api");
  scope.setTag("route", route);

  for (const [key, value] of Object.entries(context)) {
    if (value == null || SENSITIVE_CONTEXT_KEY_PATTERN.test(key)) continue;
    scope.setTag(key, String(value));
  }
}

export function captureRouteError(error: unknown, route: string, context: SafeContext = {}) {
  Sentry.withScope((scope) => {
    applySafeContext(scope, route, context);
    Sentry.captureException(error);
  });
}

export function captureRouteMessage(
  message: string,
  route: string,
  context: SafeContext = {},
  level: Sentry.SeverityLevel = "warning"
) {
  Sentry.withScope((scope) => {
    applySafeContext(scope, route, context);
    scope.setLevel(level);
    Sentry.captureMessage(message);
  });
}
