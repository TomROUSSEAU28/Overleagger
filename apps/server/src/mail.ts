/**
 * Outgoing e-mail (any SMTP service, e.g. Brevo's free plan): the contact form, and the codes
 * that confirm an address or let someone choose a new password. Optional: without SMTP settings
 * nothing is sent (messages are read in the admin page, accounts are not confirmed).
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
  /** Send a code to confirm an address or choose a new password; false when not configured. */
  sendCode(to: string, purpose: 'signup' | 'reset', code: string): Promise<boolean>;
}

const CODE_TEXT = {
  signup: {
    subject: (code: string) => `${code} is your Circuit Notebook code`,
    text: (code: string) =>
      `Welcome to Circuit Notebook!\n\nYour code to confirm your e-mail address: ${code}\n\nType it where you created your account. It works for 30 minutes.\nIf you did not create an account, ignore this e-mail.`,
  },
  reset: {
    subject: (code: string) => `${code} is your code to choose a new password`,
    text: (code: string) =>
      `Your code to choose a new Circuit Notebook password: ${code}\n\nType it where you asked for it. It works for 30 minutes.\nIf you did not ask for it, ignore this e-mail: your password stays the same.`,
  },
};

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

    async sendCode(address, purpose, code) {
      const from = config.smtp?.from || to;
      if (!t || !from) return false;
      const c = CODE_TEXT[purpose];
      await t.sendMail({ from, to: address, subject: c.subject(code), text: c.text(code) });
      return true;
    },
  };
}
