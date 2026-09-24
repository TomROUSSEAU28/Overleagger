/**
 * Outgoing e-mail for the contact form (any SMTP service, e.g. Brevo's free plan). Optional:
 * without SMTP settings nothing is sent and messages are read in the admin page.
 */
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
      await t.sendMail({
        from: config.smtp?.from || to,
        to,
        replyTo: m.name ? `"${m.name.replace(/"/g, '')}" <${m.email}>` : m.email,
        subject: `[Circuit Notebook] Message from ${m.name || m.email}`,
        text: `${m.body}\n\n— ${m.name || '(no name)'} <${m.email}>\nSent from the contact form of the site.`,
      });
      return true;
    },
  };
}
