import crypto from 'crypto';
import nodemailer from 'nodemailer';

const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTempPassword(length = 10) {
  const bytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += TEMP_PASSWORD_ALPHABET[bytes[i] % TEMP_PASSWORD_ALPHABET.length];
  }
  return password;
}

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendMail({ to, subject, text, html }) {
  if (!mailConfigured()) {
    const err = new Error('L\'envoi d\'e-mail n\'est pas configuré (paramètres SMTP).');
    err.status = 503;
    throw err;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
}

export async function sendTempPasswordEmail(user, tempPassword) {
  const subject = 'École — nouveau mot de passe';
  const text = [
    `Bonjour ${user.full_name},`,
    '',
    'Voici un nouveau mot de passe pour votre compte École :',
    '',
    `Identifiant : ${user.username}`,
    `Mot de passe : ${tempPassword}`,
    '',
    'Connectez-vous puis changez-le si besoin.'
  ].join('\n');

  await sendMail({ to: user.email, subject, text });
}
