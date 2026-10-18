// Every gym has exactly one WhatsApp connection row (starting "disconnected") and one agent
// settings row (starting "disabled"). INSERT IGNORE makes this safe to repeat: a retried gym
// creation, the migration's back-fill and a lazy check all end with the same single pair.
async function provisionAgent(db, gymId) {
  await db.query("INSERT IGNORE INTO whatsapp_connections (gym_id) VALUES (?)", [gymId]);
  await db.query("INSERT IGNORE INTO whatsapp_agent_settings (gym_id) VALUES (?)", [gymId]);
}

module.exports = { provisionAgent };
