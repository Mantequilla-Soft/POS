const nodemailer = require('nodemailer');

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

function isConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

async function sendOverdueReminder(member, store) {
  const transporter = createTransporter();
  const daysOverdue = member.nextDueDate
    ? Math.floor((Date.now() - new Date(member.nextDueDate)) / 86400000)
    : 0;

  const vars = {
    memberName:   member.name,
    businessName: store.businessName,
    daysOverdue:  String(daysOverdue),
    hiveAccount:  store.hiveAccount || '',
  };

  const customSubject = store.emailSettings?.reminderSubject?.trim();
  const customBody    = store.emailSettings?.reminderBody?.trim();
  const lang          = store.language === 'es' ? 'es' : 'en';

  const defaultSubject = lang === 'es'
    ? `Recordatorio de pago — ${store.businessName}`
    : `Membership payment reminder — ${store.businessName}`;

  const defaultBody = lang === 'es'
    ? [
        `Hola ${member.name},`,
        '',
        `Tu membresía en ${store.businessName} está vencida por ${daysOverdue} día${daysOverdue !== 1 ? 's' : ''}.`,
        '',
        store.hiveAccount
          ? `Para renovar, envía tu pago a @${store.hiveAccount} en Hive o comunícate con la recepción.`
          : 'Comunícate con la recepción para renovar tu membresía.',
        '',
        '¡Gracias!',
        store.businessName,
      ].join('\n')
    : [
        `Hi ${member.name},`,
        '',
        `Your membership at ${store.businessName} is overdue by ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''}.`,
        '',
        store.hiveAccount
          ? `To renew, send payment to @${store.hiveAccount} on Hive or contact the front desk.`
          : 'Please contact the front desk to renew your membership.',
        '',
        'Thank you!',
        store.businessName,
      ].join('\n');

  const subject  = customSubject ? interpolate(customSubject, vars) : defaultSubject;
  const bodyText = customBody    ? interpolate(customBody, vars)    : defaultBody;

  const text = bodyText;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">

        <!-- Header -->
        <tr>
          <td style="background:#1c1917;padding:28px 32px">
            <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.3px">${store.businessName}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px">
            <p style="margin:0 0 8px;font-size:15px;color:#78716c">Membership Reminder</p>
            <h1 style="margin:0 0 24px;font-size:24px;font-weight:700;color:#1c1917;line-height:1.2">
              Your payment is overdue
            </h1>

            <p style="margin:0 0 16px;font-size:15px;color:#44403c;line-height:1.6">
              Hi <strong>${member.name}</strong>,
            </p>
            ${customBody
              ? `<p style="margin:0 0 24px;font-size:15px;color:#44403c;line-height:1.6;white-space:pre-line">${interpolate(customBody, vars)}</p>`
              : lang === 'es'
                ? `<p style="margin:0 0 24px;font-size:15px;color:#44403c;line-height:1.6">
              Tu membresía en <strong>${store.businessName}</strong> está
              <strong style="color:#c2410c">vencida por ${daysOverdue} día${daysOverdue !== 1 ? 's' : ''}</strong>.
              Renueva para mantener tu acceso sin interrupciones.
            </p>`
                : `<p style="margin:0 0 24px;font-size:15px;color:#44403c;line-height:1.6">
              Your membership at <strong>${store.businessName}</strong> is
              <strong style="color:#c2410c">${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue</strong>.
              Renewing keeps your access uninterrupted — please take a moment to settle your balance.
            </p>`}

            ${store.hiveAccount ? `
            <!-- Payment box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:6px;margin-bottom:24px">
              <tr>
                <td style="padding:16px 20px">
                  <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:.5px">Pay via Hive</p>
                  <p style="margin:0;font-size:18px;font-weight:700;color:#1c1917">@${store.hiveAccount}</p>
                  <p style="margin:4px 0 0;font-size:13px;color:#78716c">Send HBD or HIVE to this account</p>
                </td>
              </tr>
            </table>` : ''}

            <p style="margin:0;font-size:14px;color:#78716c;line-height:1.6">
              Questions? Contact the front desk and we'll sort it out.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#fafaf9;border-top:1px solid #e7e5e4;padding:16px 32px">
            <p style="margin:0;font-size:12px;color:#a8a29e;text-align:center">
              ${store.businessName} &nbsp;·&nbsp; You're receiving this because your membership payment is past due.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: member.email,
      subject,
      text,
      html,
    });
  } finally {
    transporter.close();
  }
}

async function sendBackupEmail(store, toEmail, csvContent) {
  const transporter = createTransporter();
  const today = new Date().toISOString().slice(0, 10);
  const filename = `members-${today}.csv`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: toEmail,
      subject: `Monthly member backup — ${store.businessName} (${today})`,
      text: `Hi,\n\nPlease find your monthly member list backup for ${store.businessName} attached.\n\nThis email was sent automatically by POSHIVE.\n`,
      attachments: [{
        filename,
        content: '﻿' + csvContent,  // BOM for Excel
        contentType: 'text/csv; charset=utf-8',
      }],
    });
  } finally {
    transporter.close();
  }
}

module.exports = { sendOverdueReminder, sendBackupEmail, isConfigured };
