export type SortDirection = "asc" | "desc";

export type SortState<T extends string> = {
  column: T;
  direction: SortDirection;
};

export function nextSortState<T extends string>(
  current: SortState<T>,
  column: T
): SortState<T> {
  if (current.column !== column) {
    return { column, direction: "asc" };
  }

  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function compareNumber(a: number, b: number): number {
  return a - b;
}

export function withSortDirection(value: number, direction: SortDirection): number {
  return direction === "asc" ? value : -value;
}
