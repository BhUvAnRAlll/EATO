// Daily usage counters per gym (whatsapp_usage). Costs are estimates from whatsapp_pricing and
// are filled in by the reporting phase; here only the counts move.
async function recordUsage(db, gymId, kind, count = 1, { inputTokens = 0, outputTokens = 0 } = {}) {
  await db.query(
    `INSERT INTO whatsapp_usage (gym_id, day, kind, count, ai_input_tokens, ai_output_tokens)
     VALUES (?, CURDATE(), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE count = count + VALUES(count), ai_input_tokens = ai_input_tokens + VALUES(ai_input_tokens), ai_output_tokens = ai_output_tokens + VALUES(ai_output_tokens)`,
    [gymId, kind, count, inputTokens, outputTokens],
  );
}

module.exports = { recordUsage };
