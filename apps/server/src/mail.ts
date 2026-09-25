/**
 * Outgoing e-mail for the contact form (any SMTP service, e.g. Brevo's free plan). Optional:
 * without SMTP settings nothing is sent and messages are read in the admin page.
 */
import { createHash, randomBytes } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from './config';

export interface ContactMail {
  name: string;
  email: string;
  body: string;
}

export interface Mailer {
  /** Send a message of the contact form to the site's address; false when not configured. */
  sendContact(m: ContactMail): Promise<boolean>;
}

export function createMailer(config: Config, transport?: Transporter): Mailer {
  const to = config.contactEmail;
  const t =
    transport ??
    (config.smtp
      ? nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.pass } } : {}),
        })
      : undefined);
  return {
    async sendContact(m) {
      if (!t || !to) return false;
      const sender = config.smtp?.from || to;
      const address = /<([^>]+)>/.exec(sender)?.[1] ?? sender.trim();
      const domain = address.split('@')[1] || 'localhost';
      const name = m.name.replace(/["<>\r\n]/g, '').trim();
      // One conversation per person in the mailbox: the same subject (the address, not the name,
      // which may be typed differently) and the same made-up first message for all the messages
      // of one address, like the notifications of GitHub. The name shows as the sender.
      const who = createHash('sha256').update(m.email).digest('hex').slice(0, 16);
      const thread = `<contact.${who}@${domain}>`;
      await t.sendMail({
        from: { name: `${name || m.email} via Circuit Notebook`, address },
        to,
        replyTo: name ? { name, address: m.email } : m.email,
        subject: `[Circuit Notebook] Message from ${m.email}`,
        messageId: `<contact.${who}.${Date.now()}.${randomBytes(4).toString('hex')}@${domain}>`,
        inReplyTo: thread,
        references: thread,
        text: `${m.body}\n\n— ${name || '(no name)'} <${m.email}>\nSent from the contact form of the site.`,
      });
      return true;
    },
  };
}
