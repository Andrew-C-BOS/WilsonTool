// lib/mailer.ts
/* Server-only file; do NOT add "use client" */

import type { SESv2Client } from "@aws-sdk/client-sesv2";

/* ─────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────── */
export type MailAttachment = {
  filename: string;
  contentType: string;
  /**
   * Base64-encoded body of the file.
   * (We can also support Buffer/Uint8Array, but base64 string is simplest.)
   */
  contentBase64: string;
};


export type MailInput = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  traceId?: string; // for correlating logs
  attachments?: MailAttachment[];
};

export interface Mailer {
  send(input: MailInput): Promise<{ ok: true } | { ok: false; error: string }>;
}

/* ─────────────────────────────────────────────────────────────
   Env + debug
───────────────────────────────────────────────────────────── */
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || "console").toLowerCase();
const MAIL_FROM = process.env.MAIL_FROM || "MILO <no-reply@milohomesbos.com>";
const AWS_SES_CONFIGURATION_SET = process.env.AWS_SES_CONFIGURATION_SET || "";
const MAIL_DEBUG = process.env.MAIL_DEBUG === "1";

function dbg(...args: any[]) {
  if (MAIL_DEBUG) {
    // eslint-disable-next-line no-console
    console.log("[MAIL:debug]", ...args);
  }
}

/* ─────────────────────────────────────────────────────────────
   OTP template
───────────────────────────────────────────────────────────── */
export function renderOtpEmail(opts: {
  code: string;
  toDisplay?: string;
  brand?: string;
  minutes?: number;
}) {
  const brand = opts.brand ?? "MILO";
  const minutes = opts.minutes ?? 10;
  const subject = `${brand} verification code: ${opts.code}`;
  const text =
    `Your ${brand} verification code is ${opts.code}.\n\n` +
    `It expires in ${minutes} minutes. If you didn’t request this, please ignore this email.`;
  const html = `<!doctype html>
<html>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#f8fafc; padding:24px">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px">
      <tr><td style="padding:24px">
        <h1 style="font-size:18px; margin:0 0 8px; color:#111827;">Verify your email</h1>
        <p style="font-size:14px; color:#374151; margin:0 0 16px;">
          Use this code to continue${opts.toDisplay ? ` as <strong>${escapeHtml(opts.toDisplay)}</strong>` : ""}.
        </p>
        <div style="display:inline-block; padding:12px 16px; border:1px solid #e5e7eb; border-radius:10px; font-weight:700; letter-spacing:1px; font-size:16px; color:#111827;">
          ${escapeHtml(opts.code)}
        </div>
        <p style="font-size:12px; color:#6b7280; margin:16px 0 0;">
          This code expires in ${minutes} minutes.
        </p>
      </td></tr>
    </table>
    <p style="text-align:center; font-size:12px; color:#9ca3af; margin-top:16px;">${brand}</p>
  </body>
</html>`;
  return { subject, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]!));
}

function rand(n = 16): string {
  return Array.from({ length: n }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
}

function buildMimeWithAttachments(input: {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments: MailAttachment[];
}): string {
  const boundaryMixed = "mixed_" + rand(16);
  const boundaryAlt = "alt_" + rand(16);

  const textPart = input.text || "";
  const htmlPart =
    input.html ||
    `<html><body><pre style="font-family:system-ui, -apple-system, Segoe UI, Roboto, Arial;">${textPart}</pre></body></html>`;

  let mime = "";

  mime += `From: ${input.from}\r\n`;
  mime += `To: ${input.to}\r\n`;
  mime += `Subject: ${input.subject}\r\n`;
  mime += `MIME-Version: 1.0\r\n`;
  mime += `Content-Type: multipart/mixed; boundary="${boundaryMixed}"\r\n`;
  mime += `\r\n`;
  mime += `--${boundaryMixed}\r\n`;
  mime += `Content-Type: multipart/alternative; boundary="${boundaryAlt}"\r\n`;
  mime += `\r\n`;

  // Text part
  mime += `--${boundaryAlt}\r\n`;
  mime += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  mime += `Content-Transfer-Encoding: 7bit\r\n`;
  mime += `\r\n`;
  mime += `${textPart}\r\n`;
  mime += `\r\n`;

  // HTML part
  mime += `--${boundaryAlt}\r\n`;
  mime += `Content-Type: text/html; charset="UTF-8"\r\n`;
  mime += `Content-Transfer-Encoding: 7bit\r\n`;
  mime += `\r\n`;
  mime += `${htmlPart}\r\n`;
  mime += `\r\n`;

  mime += `--${boundaryAlt}--\r\n`;

  // Attachments
  for (const att of input.attachments) {
    mime += `--${boundaryMixed}\r\n`;
    mime += `Content-Type: ${att.contentType}; name="${att.filename}"\r\n`;
    mime += `Content-Transfer-Encoding: base64\r\n`;
    mime += `Content-Disposition: attachment; filename="${att.filename}"\r\n`;
    mime += `\r\n`;
    mime += `${att.contentBase64}\r\n`;
    mime += `\r\n`;
  }

  mime += `--${boundaryMixed}--\r\n`;

  return mime;
}

/* ─────────────────────────────────────────────────────────────
   Factory
───────────────────────────────────────────────────────────── */
let _mailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (_mailer) return _mailer;
  switch (MAIL_PROVIDER) {
    case "resend":   _mailer = new ResendMailer(); break;
    case "ses":      _mailer = new SESMailer();    break;
    case "postmark": _mailer = new PostmarkMailer(); break;
    case "console":
    default:         _mailer = new ConsoleMailer(); break;
  }
  dbg("provider =", MAIL_PROVIDER, "from =", MAIL_FROM);
  return _mailer;
}

/* ─────────────────────────────────────────────────────────────
   Console (dev)
───────────────────────────────────────────────────────────── */
class ConsoleMailer implements Mailer {
  async send(input: MailInput) {
    const from = input.from || MAIL_FROM;
    // eslint-disable-next-line no-console
    console.log("[MAIL:console]", JSON.stringify({ ...input, from }, null, 2));
    return { ok: true as const };
  }
}

/* ─────────────────────────────────────────────────────────────
   Resend
───────────────────────────────────────────────────────────── */
class ResendMailer implements Mailer {
  private apiKey = process.env.RESEND_API_KEY || "";
  async send(input: MailInput) {
    if (!this.apiKey) return { ok: false as const, error: "missing_RESEND_API_KEY" };
    const from = input.from || MAIL_FROM;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          headers: input.headers,
        }),
      });
      if (res.ok) return { ok: true as const };
      if (res.status >= 500 || res.status === 429) {
        dbg("resend retry", { status: res.status, attempt });
        await wait(msBackoff(attempt));
        continue;
      }
      const err = await safeText(res);
      dbg("resend failed", err);
      return { ok: false as const, error: `resend_${res.status}_${err}` };
    }
    return { ok: false as const, error: "resend_retry_exhausted" };
  }
}

/* ─────────────────────────────────────────────────────────────
   AWS SES (v2) — supports dedicated email creds
───────────────────────────────────────────────────────────── */
class SESMailer implements Mailer {
  private client: SESv2Client | null = null;

  private ensure() {
    if (this.client) return this.client;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SESv2Client } = require("@aws-sdk/client-sesv2") as typeof import("@aws-sdk/client-sesv2");

    const region = process.env.AWS_REGION || "us-east-1";
    const accessKeyId  = process.env.AWS_EMAIL_ACCESS_KEY_ID  || process.env.AWS_ACCESS_KEY_ID;
    const secretAccess = process.env.AWS_EMAIL_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

    dbg("SES init", { region, usingEmailKeys: !!process.env.AWS_EMAIL_ACCESS_KEY_ID });

    this.client = new SESv2Client({
      region,
      credentials: (accessKeyId && secretAccess)
        ? { accessKeyId, secretAccessKey: secretAccess }
        : undefined, // IAM role on AWS if present
    });
    return this.client!;
  }

  // SES allows only [A-Za-z0-9_.-@] in tag values, max length 256.
  private sanitizeSesTagValue(v: string) {
    const cleaned = v.replace(/[^A-Za-z0-9_\-\.@]/g, "_");
    return cleaned.slice(0, 256);
  }

  async send(input: MailInput) {
    const client = this.ensure();
    const from = input.from || MAIL_FROM;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SendEmailCommand } = require("@aws-sdk/client-sesv2") as typeof import("@aws-sdk/client-sesv2");

    const EmailTags =
      [
        ...(input.idempotencyKey
          ? [{ Name: "IdempotencyKey", Value: this.sanitizeSesTagValue(input.idempotencyKey) }]
          : []),
        ...(input.traceId
          ? [{ Name: "TraceId", Value: this.sanitizeSesTagValue(input.traceId) }]
          : []),
      ] as Array<{ Name: string; Value: string }>;

    // If no attachments, use existing Simple flow (no behavior change)
    const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
    if (!hasAttachments) {
      const cmd = new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject, Charset: "UTF-8" },
            Body: {
              Html: input.html ? { Data: input.html, Charset: "UTF-8" } : undefined,
              Text: input.text ? { Data: input.text, Charset: "UTF-8" } : undefined,
            },
          },
        },
        ConfigurationSetName: AWS_SES_CONFIGURATION_SET || undefined,
        EmailTags,
      });

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const out = await client.send(cmd);
          dbg("SES sent", { requestId: out?.$metadata?.requestId, traceId: input.traceId });
          return { ok: true as const };
        } catch (e: any) {
          const status = String(e?.$metadata?.httpStatusCode || "");
          const name = String(e?.name || "ses_error");
          const message = String(e?.message || "");
          dbg("SES error", { status, name, message, attempt, traceId: input.traceId });

          if (status === "429" || status.startsWith("5")) {
            await wait(msBackoff(attempt));
            continue;
          }
          return { ok: false as const, error: `ses_${status || name}:${message}` };
        }
      }
      return { ok: false as const, error: "ses_retry_exhausted" };
    }

    // Attachments present → build raw MIME and send as Raw content
    const rawMime = buildMimeWithAttachments({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: input.attachments!,
    });

    const rawCmd = new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Raw: {
          Data: Buffer.from(rawMime, "utf-8"),
        },
      },
      ConfigurationSetName: AWS_SES_CONFIGURATION_SET || undefined,
      EmailTags,
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const out = await client.send(rawCmd);
        dbg("SES sent (raw)", { requestId: out?.$metadata?.requestId, traceId: input.traceId });
        return { ok: true as const };
      } catch (e: any) {
        const status = String(e?.$metadata?.httpStatusCode || "");
        const name = String(e?.name || "ses_error");
        const message = String(e?.message || "");
        dbg("SES raw error", { status, name, message, attempt, traceId: input.traceId });

        if (status === "429" || status.startsWith("5")) {
          await wait(msBackoff(attempt));
          continue;
        }
        return { ok: false as const, error: `ses_${status || name}:${message}` };
      }
    }

    return { ok: false as const, error: "ses_raw_retry_exhausted" };
  }
}

/* ─────────────────────────────────────────────────────────────
   Postmark
───────────────────────────────────────────────────────────── */
class PostmarkMailer implements Mailer {
  private token = process.env.POSTMARK_SERVER_TOKEN || "";
  async send(input: MailInput) {
    if (!this.token) return { ok: false as const, error: "missing_POSTMARK_SERVER_TOKEN" };
    const from = input.from || MAIL_FROM;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": this.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          From: from,
          To: input.to,
          Subject: input.subject,
          TextBody: input.text,
          HtmlBody: input.html,
          Headers: input.headers
            ? Object.entries(input.headers).map(([Name, Value]) => ({ Name, Value }))
            : undefined,
        }),
      });
      if (res.ok) return { ok: true as const };
      if (res.status >= 500 || res.status === 429) {
        dbg("postmark retry", { status: res.status, attempt });
        await wait(msBackoff(attempt));
        continue;
      }
      const err = await safeText(res);
      dbg("postmark failed", err);
      return { ok: false as const, error: `postmark_${res.status}_${err}` };
    }
    return { ok: false as const, error: "postmark_retry_exhausted" };
  }
}

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
function msBackoff(attempt: number) {
  return Math.min(2000, 200 * Math.pow(2, attempt)); // 200, 400, 800, cap 2s
}
function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
async function safeText(res: Response) {
  try { return (await res.text()).slice(0, 300); } catch { return "unknown"; }
}

/* ─────────────────────────────────────────────────────────────
   Facade
───────────────────────────────────────────────────────────── */
export async function sendMail(input: MailInput) {
  if (!input.to || !input.subject) {
    return { ok: false as const, error: "missing_to_or_subject" };
  }
  return getMailer().send({ from: input.from || MAIL_FROM, ...input });
}
