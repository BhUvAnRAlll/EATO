// Turns a WhatsApp Cloud API webhook body into a flat list of events, each with a stable key
// so a repeated delivery is stored once. Pure: no database, no network. Anything unexpected is
// skipped rather than trusted. The receiving phone_number_id decides the gym later (routing.js);
// nothing in a message body ever does.
const MAX_TEXT = 4096;

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : null);
const digits = (value) => (typeof value === "string" && /^\d{6,20}$/.test(value) ? value : null);
const providerId = (value) => (typeof value === "string" && /^[A-Za-z0-9._:=+\/-]{1,128}$/.test(value) ? value : null);

function parseMessage(message, contacts, phoneNumberId) {
  const id = providerId(message?.id);
  const from = digits(message?.from);
  if (!id || !from) return null;
  const contact = contacts.find((c) => c?.wa_id === from);
  const base = {
    kind: "message",
    key: `msg:${id}`,
    phoneNumberId,
    providerMessageId: id,
    from,
    profileName: text(contact?.profile?.name, 120),
    timestamp: Number(message.timestamp) || null,
  };
  if (message.type === "text") return { ...base, type: "text", body: text(message.text?.body, MAX_TEXT) ?? "" };
  if (message.type === "image") {
    const mediaId = providerId(message.image?.id);
    return { ...base, type: "image", body: text(message.image?.caption, 1024), media: mediaId ? { id: mediaId, mimeType: text(message.image?.mime_type, 60), sha256: text(message.image?.sha256, 88) } : null };
  }
  return { ...base, type: "other", body: null };
}

const STATUSES = ["sent", "delivered", "read", "failed"];

function parseStatus(status, phoneNumberId) {
  const id = providerId(status?.id);
  if (!id || !STATUSES.includes(status?.status)) return null;
  const error = Array.isArray(status.errors) ? status.errors[0] : null;
  return {
    kind: "status",
    key: `status:${id}:${status.status}`,
    phoneNumberId,
    providerMessageId: id,
    status: status.status,
    errorCode: error?.code !== undefined ? String(error.code).slice(0, 40) : null,
    category: text(status.pricing?.category, 30),
    billable: typeof status.pricing?.billable === "boolean" ? status.pricing.billable : null,
    timestamp: Number(status.timestamp) || null,
  };
}

function parseWebhook(body) {
  const events = [];
  if (body?.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) return events;
  for (const entry of body.entry.slice(0, 50)) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes.slice(0, 50) : []) {
      if (change?.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = digits(value.metadata?.phone_number_id);
      if (!phoneNumberId) continue;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const message of Array.isArray(value.messages) ? value.messages.slice(0, 100) : []) {
        const parsed = parseMessage(message, contacts, phoneNumberId);
        if (parsed) events.push(parsed);
      }
      for (const status of Array.isArray(value.statuses) ? value.statuses.slice(0, 100) : []) {
        const parsed = parseStatus(status, phoneNumberId);
        if (parsed) events.push(parsed);
      }
    }
  }
  return events;
}

module.exports = { parseWebhook };
