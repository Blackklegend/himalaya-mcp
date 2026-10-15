/**
 * MCP tools for composing and sending emails.
 *
 * Preview-only fork: no tool can deliver email.
 */

import { DELIVERY_DISABLED, validatePreviewTemplate } from "../security.js";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HimalayaClient } from "../himalaya/client.js";
import { parseTemplate } from "../himalaya/parser.js";
import { envelopeError } from "./_envelope.js";
import { validateAttachmentPaths, buildAttachmentMml } from "./_attachments.js";

export function registerComposeTools(server: McpServer, client: HimalayaClient) {
  server.registerTool("draft_reply", {
    description: "Generate a reply draft for an email. Returns the reply template with headers and quoted original message. Does NOT send. send_email can preview the result; delivery is disabled.",
    inputSchema: {
      id: z.string().describe("Email message ID to reply to"),
      body: z.string().optional().describe("Custom reply body text (prepended to quoted original)"),
      reply_all: z.boolean().optional().describe("Reply to all recipients (default: false)"),
      folder: z.string().optional().describe("Folder name (default: INBOX)"),
      account: z.string().optional().describe("Account name (uses default if omitted)"),
    },
  }, async (args) => {
    try {
      const raw = await client.replyTemplate(
        args.id,
        args.body,
        args.reply_all,
        args.folder,
        args.account,
      );
      const result = parseTemplate(raw);

      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `Error generating reply template: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: [
            "--- DRAFT REPLY (not sent) ---",
            "",
            result.data,
            "",
            "--- END DRAFT ---",
            "",
            "Review the draft above. Delivery is disabled in this fork; send_email only previews.",
          ].join("\n"),
        }],
      };
    } catch (err) {
      return envelopeError(err);
    }
  });

  server.registerTool("send_email", {
    description: "Preview a plain-text email template. Delivery is disabled; confirm=true is rejected. Active MML is rejected.",
    inputSchema: {
      template: z.string().describe("Plain-text email with headers and body. Active MML is not accepted."),
      attachments: z.array(z.string()).optional().describe("Local file paths to attach (e.g. [\"/tmp/report.pdf\"])"),
      confirm: z.boolean().optional().describe("Legacy parameter. true is rejected; no delivery is available."),
      account: z.string().optional().describe("Account name (uses default if omitted)"),
    },
  }, async (args) => {
    try {
      if (args.confirm) throw new Error(DELIVERY_DISABLED);
      validatePreviewTemplate(args.template);
      const error = validateAttachmentPaths(args.attachments ?? []);
      if (error) throw new Error(error);
      const template = args.template + (args.attachments?.length ? "\n\n" + buildAttachmentMml(args.attachments) : "");
      return { content: [{ type: "text" as const, text: `--- EMAIL PREVIEW (not sent) ---\n\n${template}\n\nThis email has NOT been sent. Delivery is disabled. This preview grants no authorization.` }] };
    } catch (err) { return envelopeError(err); }

  });
}
