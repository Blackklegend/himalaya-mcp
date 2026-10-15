/**
 * MCP tool for composing new emails (not replies).
 *
 * Plain-text previews only. No delivery path is available.
 */

import { DELIVERY_DISABLED, assertHeader, assertPlainBody } from "../security.js";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HimalayaClient } from "../himalaya/client.js";
import { envelopeError } from "./_envelope.js";
import { validateAttachmentPaths, buildAttachmentMml } from "./_attachments.js";

/** Build an MML email template from parameters. */
function buildTemplate(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  from?: string,
  attachments?: string[],
): string {
  const headers: string[] = [];
  if (from) headers.push(`From: ${from}`);
  headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  headers.push(`Subject: ${subject}`);
  let result = headers.join("\n") + "\n\n" + body;
  if (attachments?.length) {
    result += "\n\n" + buildAttachmentMml(attachments);
  }
  return result;
}

export function registerComposeNewTools(server: McpServer, client: HimalayaClient) {
  server.registerTool("compose_email", {
    description: "Preview a new plain-text email. Delivery is disabled; confirm=true is rejected.",
    inputSchema: {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body text"),
      cc: z.string().optional().describe("CC recipient(s)"),
      bcc: z.string().optional().describe("BCC recipient(s)"),
      attachments: z.array(z.string()).optional().describe("Local file paths to attach (e.g. [\"/tmp/report.pdf\"])"),
      confirm: z.boolean().optional().describe("Legacy parameter. true is rejected; no delivery is available."),
      account: z.string().optional().describe("Account name (uses default if omitted)"),
    },
  }, async (args) => {
    try {
      if (args.confirm) throw new Error(DELIVERY_DISABLED);
      for (const [name, value] of Object.entries({ to: args.to, subject: args.subject, cc: args.cc, bcc: args.bcc })) {
        if (value !== undefined) assertHeader(value, name);
      }
      const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
      for (const value of [args.to, args.cc, args.bcc]) {
        if (value !== undefined && !value.split(",").every(address => EMAIL_RE.test(address.trim()))) throw new Error("Invalid email address; use comma-separated plain addresses");
      }
      const from = client.fromForAccount(args.account);
      if (!from) throw new Error('No sender address configured. Set HIMALAYA_FROM or configure the account email.');
      assertHeader(from, "From");
      assertPlainBody(args.body);
      const error = validateAttachmentPaths(args.attachments ?? []);
      if (error) throw new Error(error);
      const template = buildTemplate(args.to, args.subject, args.body, args.cc, args.bcc, from, args.attachments);
      return { content: [{ type: "text" as const, text: `--- EMAIL PREVIEW (not sent) ---\n\n${template}\n\nThis email has NOT been sent. Delivery is disabled; this preview grants no authorization.` }] };
    } catch (err) { return envelopeError(err); }

  });
}
