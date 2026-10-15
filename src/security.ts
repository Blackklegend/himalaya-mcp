/** Operator configuration only. Tool arguments never grant capabilities. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const CAPABILITIES = ["drafts", "mailbox-write", "attachments", "export", "clipboard", "calendar", "reminders"] as const;
export type Capability = typeof CAPABILITIES[number];
export const DELIVERY_DISABLED = "Delivery disabled in this hardened fork. confirm=true cannot authorize sending.";

export function loadCapabilities(): ReadonlySet<Capability> {
  const values = (process.env.HIMALAYA_CAPABILITIES ?? "").split(",").map(v => v.trim()).filter(Boolean);
  for (const value of values) {
    if (!(CAPABILITIES as readonly string[]).includes(value)) throw new Error(`Unknown HIMALAYA_CAPABILITIES value: ${value}`);
  }
  return new Set(values as Capability[]);
}

export function requireCapability(capability: Capability): void {
  if (!loadCapabilities().has(capability)) throw new Error(`Capability disabled: ${capability}`);
}

// Exhaustive table: a new tool cannot silently become available by default.
export const TOOL_CAPABILITY: Record<string, Capability | null | "disabled"> = {
  list_emails: null, search_emails: null, read_email: null,
  get_unread_count: null, list_starred: null, list_folders: null,
  list_threads: null, read_thread: null, render_email: null,
  export_to_markdown: null, create_action_item: null, health_check: null,
  draft_reply: "drafts", compose_email: "drafts", send_email: "drafts",
  flag_email: "mailbox-write", move_email: "mailbox-write",
  create_folder: "mailbox-write", delete_folder: "mailbox-write",
  read_email_html: "attachments", read_email_raw: "attachments",
  list_attachments: "attachments", download_attachment: "attachments",
  extract_calendar_event: "attachments", copy_to_clipboard: "clipboard",
  create_calendar_event: "calendar", create_reminder: "reminders",
  // Legacy snooze storage overwrites a fixed path in the home directory.
  // Keep unavailable until it has a constrained storage implementation.
  snooze_email: "disabled", list_snoozed_emails: "disabled",
};

export function permittedTools(capabilities = loadCapabilities()): string[] {
  return Object.entries(TOOL_CAPABILITY).filter(([, cap]) => cap === null || (cap !== "disabled" && capabilities.has(cap))).map(([name]) => name);
}

/** Filter registration itself, so disabled tools cannot be invoked by name. */
export function restrictTools(server: McpServer, capabilities = loadCapabilities()): McpServer {
  const allowed = new Set(permittedTools(capabilities));
  return new Proxy(server, {
    get(target, property) {
      if (property === "registerTool") return (name: string, ...args: unknown[]) => {
        if (!Object.hasOwn(TOOL_CAPABILITY, name)) throw new Error(`Unclassified tool: ${name}`);
        if (!allowed.has(name)) return undefined;
        return (target.registerTool as Function).call(target, name, ...args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function assertHeader(value: string, field: string): void {
  if (/[\x00-\x1f\x7f\u0085\u2028\u2029]/u.test(value)) throw new Error(`${field} contains a control character or line break`);
}

export function assertPlainBody(value: string): void {
  if (value.includes("<#") || value.includes("\0")) throw new Error("MML directives and NUL are not accepted in plain-text drafts");
}

/** Raw templates are displayed only; reject active MML and ambiguous headers. */
export function validatePreviewTemplate(template: string): void {
  assertPlainBody(template);
  const normalized = template.replace(/\r\n/g, "\n");
  if (normalized.includes("\r")) throw new Error("Bare CR in template");
  const separator = normalized.indexOf("\n\n");
  if (separator < 0) throw new Error("Template must contain headers followed by a blank line");
  const seen = new Set<string>();
  for (const line of normalized.slice(0, separator).split("\n")) {
    const match = /^(From|To|Cc|Bcc|Subject|Date|Reply-To|In-Reply-To|References|Message-ID): ?(.*)$/i.exec(line);
    if (!match) throw new Error("Unsupported or folded template header");
    assertHeader(match[2], match[1]);
    const name = match[1].toLowerCase();
    if (seen.has(name)) throw new Error(`Duplicate template header: ${name}`);
    seen.add(name);
  }
  if (!seen.has("to") || !seen.has("subject")) throw new Error("Template needs To and Subject headers");
}
