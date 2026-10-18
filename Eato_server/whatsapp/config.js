// The WhatsApp agent's platform settings, all from Eato_server/.env (never sent to the app).
// Per-gym values (phone-number id, WhatsApp Business Account id, the gym's access token) live
// in whatsapp_connections, the token encrypted (secrets.js).
function whatsappConfig(env = process.env) {
  const graphVersion = env.META_GRAPH_VERSION ?? "";
  return {
    appId: env.META_APP_ID ?? "",
    appSecret: env.META_APP_SECRET ?? "", // signs webhook POSTs
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN ?? "", // the GET handshake
    graphVersion: /^v\d{1,3}\.\d{1,2}$/.test(graphVersion) ? graphVersion : "", // e.g. "v23.0", set from Meta's docs
    graphBase: env.META_GRAPH_BASE || "https://graph.facebook.com", // tests point this at a fake Meta
    embeddedSignupConfigId: env.META_EMBEDDED_SIGNUP_CONFIG_ID ?? "",
  };
}

module.exports = { whatsappConfig };
