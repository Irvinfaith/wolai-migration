export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isString(error)) return error;
  if (isRecord(error) && isString(error.message)) return error.message;
  return "发生未知错误";
}

export function isDomNode(target: EventTarget | null): target is Node {
  // Event targets in Obsidian pop-out windows have their own DOM constructors.
  return target !== null && "nodeType" in target;
}
