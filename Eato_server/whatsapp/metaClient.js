// The only code that talks to Meta's WhatsApp Cloud API. The access token is passed in per
// call (decrypted just before, never logged) and the API version comes from configuration.
// Errors carry Meta's numeric code and a fixed summary, never the response body or the token.
class MetaError extends Error {
  constructor(status, code, retryable) {
    super(`Meta request failed (${status}${code ? `, code ${code}` : ""})`);
    this.name = "MetaError";
    this.status = status;
    this.code = code ? String(code) : null;
    this.retryable = retryable;
    this.publicMessage = `meta_${status}${code ? `_${code}` : ""}`;
  }
}

function createMetaClient(config, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const ready = () => {
    if (!config.graphVersion) throw new MetaError(0, "not_configured", false);
  };
  const url = (path) => `${config.graphBase}/${config.graphVersion}/${path}`;

  async function call(method, path, token, body) {
    ready();
    let response;
    try {
      response = await fetchImpl(url(path), {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new MetaError(0, "network", true); // offline, DNS or a timeout: worth retrying
    }
    let json = null;
    try { json = await response.json(); } catch { /* not JSON */ }
    if (!response.ok) {
      const code = json?.error?.code ?? null;
      // 429 and 5xx are temporary; Meta's throttling codes too (4, 80007, 130429, 131048, 131056)
      const retryable = response.status === 429 || response.status >= 500 || [4, 80007, 130429, 131048, 131056].includes(Number(code));
      throw new MetaError(response.status, code, retryable);
    }
    return json ?? {};
  }

  return {
    // The number's public details; also proves the token can use it
    async getPhoneNumber({ phoneNumberId, token }) {
      const json = await call("GET", `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, token);
      return { displayPhone: typeof json.display_phone_number === "string" ? json.display_phone_number.slice(0, 32) : null, verifiedName: typeof json.verified_name === "string" ? json.verified_name.slice(0, 120) : null };
    },

    // A free-form text reply (only inside WhatsApp's 24-hour customer-service window)
    async sendText({ phoneNumberId, token, to, body }) {
      const json = await call("POST", `${encodeURIComponent(phoneNumberId)}/messages`, token, {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body, preview_url: false },
      });
      const id = json?.messages?.[0]?.id;
      if (typeof id !== "string") throw new MetaError(502, "no_message_id", true);
      return { id };
    },
  };
}

module.exports = { createMetaClient, MetaError };
