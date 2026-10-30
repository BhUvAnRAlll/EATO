// Demo Community data around one real justFit account, so the Community screens have something
// to show in development: demo members, feed posts of every type, likes, comments, a poll,
// friendships and friend requests, messages and two gyms (events, announcements, FAQs for the
// assistant). Every demo member's id starts with "user_seed_", and every demo
// gym is created by one, so `remove` deletes exactly what `seed` added and nothing else.
//
// Demo members exist only in the database (no phone to sign in with), so they show up everywhere but
// can't sign in. Nothing here is written as the real account: it only receives requests,
// likes, comments, messages, a tag and gym roles.
//
//   node scripts/community-demo.js seed   --email you@example.com --database eato [--env-file .env]
//   node scripts/community-demo.js remove --database eato [--env-file .env]
//
// Uses the database named in the env file (default .env). Any database other than eato_test
// must be named again with --database, so the script can't write to the wrong one by
// accident. Never run it against production.
const crypto = require("node:crypto");
const path = require("node:path");

const args = process.argv.slice(2);
const command = args[0];
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
process.loadEnvFile(path.join(__dirname, "..", option("env-file") ?? ".env"));
const { pool } = require("../database");
const { provisionAgent } = require("../whatsapp/provision");

const SEED = "user_seed_";
const id = () => crypto.randomUUID();
// A time `days` ago (fractions allowed), for natural-looking feed order
const ago = (days) => new Date(Date.now() - days * 86400000);
// A local calendar day `days` from now, as YYYY-MM-DD
const dayFromNow = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const code = (length) => Array.from(crypto.randomBytes(length), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");

const MEMBERS = [
  { key: "priya", name: "Priya Sharma", bio: "Training for my first full marathon · Pune" },
  { key: "arjun", name: "Arjun Mehta", bio: "Owner, Iron Temple Fitness. Lift heavy, eat well." },
  { key: "kavya", name: "Kavya Iyer", bio: "Sunrise yoga and slow mornings" },
  { key: "rohan", name: "Rohan Verma", bio: "Powerlifter in progress · 140 kg deadlift" },
  { key: "sneha", name: "Sneha Reddy", bio: "High-protein vegetarian recipes" },
  { key: "vikram", name: "Vikram Singh", bio: "Strength coach, 8 years" },
  { key: "ananya", name: "Ananya Das", bio: "Yoga and mobility coach" },
  { key: "karthik", name: "Karthik Nair", bio: "Back in the gym after a long break" },
  { key: "meera", name: "Meera Kapoor", bio: "Weekend hiker, weekday lifter" },
];
const uid = (key) => `${SEED}${key}`;

async function seed(conn, me) {
  // Demo members, with a bio each
  for (const m of MEMBERS) {
    await conn.query("INSERT INTO users (id, email, full_name, role, created_at) VALUES (?, ?, ?, ?, ?)", [uid(m.key), `${m.key}@demo.eato.test`, m.name, m.role ?? "user", ago(60)]);
    await conn.query("INSERT INTO community_profiles (user_id, bio) VALUES (?, ?)", [uid(m.key), m.bio]);
  }

  // Friendships: three friends, one request to you, one you sent, and a few between demo members
  const friends = async (a, b, requester, status) =>
    conn.query(
      "INSERT INTO community_friendships (user_low, user_high, requester_id, status, requested_at, responded_at) VALUES (LEAST(?, ?), GREATEST(?, ?), ?, ?, ?, ?)",
      [a, b, a, b, requester, status, ago(20), status === "accepted" ? ago(19) : null],
    );
  for (const key of ["priya", "kavya", "rohan"]) await friends(me, uid(key), uid(key), "accepted");
  await friends(me, uid("karthik"), uid("karthik"), "pending");
  await friends(me, uid("meera"), me, "pending");
  await friends(uid("priya"), uid("kavya"), uid("priya"), "accepted");
  await friends(uid("rohan"), uid("arjun"), uid("rohan"), "accepted");

  // Feed posts, one of each type
  const posts = {};
  const post = async (key, author, daysAgo, fields) => {
    posts[key] = id();
    await conn.query(
      `INSERT INTO community_posts (id, user_id, category, body, headline, detail, detail_date, meal_kcal, meal_protein_g, location, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [posts[key], uid(author), fields.category, fields.body, fields.headline ?? null, fields.detail ?? null, fields.detailDate ?? null,
        fields.kcal ?? null, fields.protein ?? null, fields.location ?? null, ago(daysAgo)],
    );
  };
  await post("pb", "priya", 0.1, { category: "progress", headline: "Half marathon PB", detail: "1:52 to 1:46 in ten weeks", detailDate: dayFromNow(-1), body: "Ten weeks of easy miles and one long run a week. Slow really does make you fast." });
  await post("bowl", "sneha", 0.3, { category: "meal", headline: "Paneer tikka bowl", kcal: 520, protein: 38, body: "Grilled paneer, brown rice, cucumber raita and lots of mint chutney. Lunch sorted for three days." });
  await post("deadlift", "rohan", 0.8, { category: "workout", location: "Iron Temple Fitness", body: "Deadlift day: worked up to 3 × 5 at 140 kg. Grip held this time. Accessories after: rows and hamstring curls." });
  await post("yoga", "kavya", 1.2, { category: "general", body: "Sunrise yoga in Cubbon Park this morning. Thirty minutes of flow and the whole day feels lighter." });
  await post("tip", "vikram", 1.6, { category: "general", body: "Coach tip: add one rep or a little weight each week, not both. Small, boring progress wins the year." });
  await post("split", "rohan", 2.1, { category: "poll", body: "Which training split do you run right now?" });
  await post("teach", "ananya", 2.8, { category: "achievement", headline: "200 hours of teaching", detail: "Finished my 200th hour of teaching yoga this week", body: "Grateful to every student who showed up early on cold mornings." });
  await post("preworkout", "karthik", 3.5, { category: "question", body: "What do you eat before a 6 am session? Bananas make me sluggish." });

  // The poll's options and votes
  const options = ["Push / pull / legs", "Upper / lower", "Full body", "Something else"].map((label) => ({ id: id(), label }));
  for (const [i, o] of options.entries()) await conn.query("INSERT INTO community_poll_options (id, post_id, position, label) VALUES (?, ?, ?, ?)", [o.id, posts.split, i, o.label]);
  for (const [key, choice] of [["priya", 2], ["kavya", 2], ["arjun", 0], ["vikram", 1], ["sneha", 0]]) {
    await conn.query("INSERT INTO community_poll_votes (post_id, user_id, option_id) VALUES (?, ?, ?)", [posts.split, uid(key), options[choice].id]);
  }

  // Kavya tagged you in her yoga post (it shows on your profile's Tagged tab)
  await conn.query("INSERT INTO community_post_tags (post_id, user_id) VALUES (?, ?)", [posts.yoga, me]);

  // Likes and comments, with the post counters kept in step
  const like = (postId, key) => conn.query("INSERT INTO community_post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)", [postId, uid(key), ago(0.05)]);
  const comment = (postId, key, body, daysAgo) => conn.query("INSERT INTO community_comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)", [postId, uid(key), body, ago(daysAgo)]);
  const likes = { pb: ["kavya", "rohan", "sneha", "arjun", "vikram"], bowl: ["priya", "kavya", "ananya"], deadlift: ["arjun", "vikram", "priya"], yoga: ["priya", "ananya"], tip: ["rohan", "karthik", "meera", "sneha"], teach: ["kavya", "priya"], preworkout: ["rohan"] };
  for (const [key, who] of Object.entries(likes)) for (const k of who) await like(posts[key], k);
  const comments = [
    ["pb", "kavya", "Six minutes off! Unreal 👏", 0.08],
    ["pb", "vikram", "Great pacing work. Recover well this week.", 0.06],
    ["bowl", "priya", "Saving this for meal prep Sunday.", 0.2],
    ["deadlift", "arjun", "Clean pulls today, proud of you.", 0.7],
    ["preworkout", "sneha", "Try curd with poha, or toast with peanut butter, about 45 minutes before.", 3.2],
    ["preworkout", "vikram", "Keep it small and familiar. Coffee works for a lot of people too.", 3.0],
    ["split", "meera", "Upper / lower, four days. Easy to fit around work.", 1.9],
  ];
  for (const [key, who, body, daysAgo] of comments) await comment(posts[key], who, body, daysAgo);

  // Your own latest post (if you have one) gets a like and a comment, so the bell has activity
  const [[mine]] = await conn.query("SELECT id FROM community_posts WHERE user_id = ? AND deleted_at IS NULL AND gym_id IS NULL ORDER BY created_at DESC LIMIT 1", [me]);
  if (mine) {
    await like(mine.id, "priya");
    await like(mine.id, "rohan");
    await comment(mine.id, "kavya", "Love this! Keep going 💪", 0.02);
  }

  // Messages: three conversations started by your friends, one with unread messages
  const conversation = async (key, lines, readByMe) => {
    const conversationId = id();
    const last = lines[lines.length - 1][1];
    await conn.query("INSERT INTO conversations (id, created_at, last_message_at) VALUES (?, ?, ?)", [conversationId, ago(lines[0][1]), ago(last)]);
    await conn.query("INSERT INTO conversation_members (conversation_id, user_id, last_read_at) VALUES (?, ?, ?), (?, ?, ?)", [conversationId, me, readByMe ? ago(0) : null, conversationId, uid(key), ago(0)]);
    for (const [body, daysAgo] of lines) await conn.query("INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (?, ?, ?, ?)", [conversationId, uid(key), body, ago(daysAgo)]);
  };
  await conversation("priya", [["Hey! Are you coming to the Saturday strength clinic?", 0.5], ["Arjun said there are only a few spots left", 0.45]], false);
  await conversation("rohan", [["Thanks for the spot yesterday 🙏", 1.1]], true);
  await conversation("kavya", [["Tagged you in my yoga post, come along next week!", 1.15]], false);

  // Gyms: one public gym where you are an admin, and one private studio you can ask to join
  const gym = async (fields) => {
    const gymId = id();
    await conn.query(
      `INSERT INTO gyms (id, name, tagline, description, location, address, hours, facilities, membership_tiers, guidelines,
         contact_phone, contact_email, invite_code, visibility, member_approval, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gymId, fields.name, fields.tagline, fields.description, fields.location, fields.address, JSON.stringify(fields.hours), JSON.stringify(fields.facilities),
        JSON.stringify(fields.tiers), JSON.stringify(fields.guidelines), fields.phone, fields.email, code(8), fields.visibility, fields.approval, uid(fields.owner), ago(45)],
    );
    await provisionAgent(conn, gymId); // its WhatsApp connection (disconnected) and in-app assistant
    return gymId;
  };
  const member = (gymId, userId, role, status = "active") =>
    conn.query("INSERT INTO gym_members (gym_id, user_id, role, status, requested_at, joined_at) VALUES (?, ?, ?, ?, ?, ?)", [gymId, userId, role, status, ago(30), status === "active" ? ago(30) : null]);

  const iron = await gym({
    name: "Iron Temple Fitness", tagline: "Strength for every body", owner: "arjun", visibility: "public", approval: false,
    description: "A friendly strength gym with coached classes, open floor time and a small recovery area.",
    location: "Indiranagar, Bengaluru", address: "12, 100 Feet Road, Indiranagar, Bengaluru 560038",
    hours: [{ label: "Mon–Fri", value: "5am–11pm" }, { label: "Sat–Sun", value: "6am–8pm" }],
    facilities: ["Free weights", "Squat racks", "Cardio zone", "Showers", "Lockers"],
    tiers: [{ name: "Basic", price: "₹1,499/mo", perks: "Gym floor and lockers" }, { name: "Coached", price: "₹3,999/mo", perks: "Floor plus 8 coached sessions" }],
    guidelines: ["Re-rack your weights", "Wipe down equipment after use", "Bring a towel"],
    phone: "9876543210", email: "hello@irontemple.demo",
  });
  await member(iron, uid("arjun"), "owner");
  await member(iron, uid("vikram"), "member");
  await member(iron, me, "admin");
  for (const key of ["priya", "rohan", "kavya", "sneha"]) await member(iron, uid(key), "member");
  await member(iron, uid("karthik"), "member", "pending"); // a join request in your bell (you're an admin)
  await conn.query("UPDATE gyms SET member_count = 7 WHERE id = ?", [iron]);

  const zen = await gym({
    name: "Zen Flow Yoga Studio", tagline: "Breathe, move, rest", owner: "ananya", visibility: "private", approval: true,
    description: "Small-group yoga and mobility classes. New members join after a short chat with the team.",
    location: "Koramangala, Bengaluru", address: "4th Block, Koramangala, Bengaluru 560034",
    hours: [{ label: "Every day", value: "6am–9pm" }], facilities: ["Mats provided", "Changing rooms"],
    tiers: [{ name: "Drop-in", price: "₹500/class", perks: "One class" }], guidelines: ["Arrive 5 minutes early", "Phones on silent"],
    phone: "9123456780", email: "namaste@zenflow.demo",
  });
  await member(zen, uid("ananya"), "owner");
  await member(zen, uid("kavya"), "member");
  await conn.query("UPDATE gyms SET member_count = 2 WHERE id = ?", [zen]);

  // Iron Temple's announcements, upcoming events (with RSVPs), posts and assistant FAQs
  await conn.query("INSERT INTO gym_announcements (gym_id, author_id, title, body, pinned, created_at) VALUES (?, ?, ?, ?, TRUE, ?), (?, ?, ?, ?, FALSE, ?)", [
    iron, uid("arjun"), "New squat racks are in", "Two new racks on the main floor. Please book them for heavy sessions at peak hours.", ago(2),
    iron, uid("arjun"), "Diwali hours", "We open 8am–2pm on Diwali day. Regular hours from the next day.", ago(6),
  ]);
  const event = async (fields, rsvps) => {
    const eventId = id();
    await conn.query(
      "INSERT INTO gym_events (id, gym_id, host_id, title, description, event_date, start_time, end_time, location, max_attendees, attendee_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [eventId, iron, uid(fields.host), fields.title, fields.description, dayFromNow(fields.inDays), fields.start, fields.end, fields.location, fields.max, rsvps.length],
    );
    for (const key of rsvps) await conn.query("INSERT INTO gym_event_rsvps (event_id, user_id) VALUES (?, ?)", [eventId, uid(key)]);
  };
  await event({ host: "arjun", title: "Saturday Strength Clinic", description: "Squat and deadlift technique in small groups. All levels welcome; bring a notebook.", inDays: 6, start: "07:00", end: "08:30", location: "Main floor", max: 12 }, ["priya", "rohan", "sneha"]);
  await event({ host: "vikram", title: "Mobility Monday", description: "Forty-five minutes of hips, shoulders and thoracic spine. Great after a heavy week.", inDays: 2, start: "18:30", end: "19:15", location: "Studio room", max: null }, ["kavya"]);
  for (const [author, body, daysAgo, category] of [
    ["arjun", "Welcome to the Iron Temple community! Share your wins and ask the coaches anything here.", 10, "general"],
    ["rohan", "First time hitting 140 kg on the deadlift, thanks to everyone who cheered 🎉", 0.9, "achievement"],
  ]) {
    await conn.query("INSERT INTO community_posts (id, user_id, gym_id, category, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id(), uid(author), iron, category, body, ago(daysAgo)]);
  }
  for (const [i, [question, answer]] of [
    ["What are your opening hours?", "Monday to Friday 5am–11pm, weekends 6am–8pm."],
    ["How much is a membership?", "Basic is ₹1,499 a month (gym floor and lockers). Coached is ₹3,999 a month with 8 coached sessions."],
    ["Do you have showers?", "Yes, showers and lockers are free for members. Bring your own lock."],
  ].entries()) {
    await conn.query("INSERT INTO gym_faqs (gym_id, question, answer, position) VALUES (?, ?, ?, ?)", [iron, question, answer, i]);
  }
}

// Everything the seed added, in an order the foreign keys allow (no deep cascades: MySQL 9.7
// can orphan rows three levels down, so each level is deleted explicitly)
async function remove(conn) {
  const like = `${SEED}%`;
  const [gyms] = await conn.query("SELECT id FROM gyms WHERE created_by LIKE ?", [like]);
  const gymIds = gyms.map((g) => g.id);
  // Posts on real members' posts the demo members liked or commented on: counters recomputed below
  const [touched] = await conn.query(
    "SELECT DISTINCT post_id FROM (SELECT post_id FROM community_post_likes WHERE user_id LIKE ? UNION SELECT post_id FROM community_comments WHERE user_id LIKE ?) t",
    [like, like],
  );
  const seedPosts = `SELECT id FROM community_posts WHERE user_id LIKE ?${gymIds.length ? " OR gym_id IN (?)" : ""}`;
  const seedPostParams = gymIds.length ? [like, gymIds] : [like];

  const steps = [
    ["DELETE FROM community_poll_votes WHERE user_id LIKE ? OR post_id IN (SELECT id FROM (" + seedPosts + ") p)", [like, ...seedPostParams]],
    ["DELETE FROM community_poll_options WHERE post_id IN (SELECT id FROM (" + seedPosts + ") p)", seedPostParams],
    ["DELETE FROM community_post_tags WHERE post_id IN (SELECT id FROM (" + seedPosts + ") p)", seedPostParams],
    ["DELETE FROM community_post_likes WHERE user_id LIKE ? OR post_id IN (SELECT id FROM (" + seedPosts + ") p)", [like, ...seedPostParams]],
    ["DELETE FROM community_comments WHERE user_id LIKE ? OR post_id IN (SELECT id FROM (" + seedPosts + ") p)", [like, ...seedPostParams]],
    ["DELETE FROM community_post_media WHERE post_id IN (SELECT id FROM (" + seedPosts + ") p)", seedPostParams],
    ["DELETE FROM community_reports WHERE post_id IN (SELECT id FROM (" + seedPosts + ") p)", seedPostParams],
    ["DELETE FROM community_posts WHERE id IN (SELECT id FROM (" + seedPosts + ") p)", seedPostParams],
    ["DELETE m FROM messages m JOIN conversation_members cm ON cm.conversation_id = m.conversation_id WHERE cm.user_id LIKE ?", [like]],
    ["DELETE FROM conversations WHERE id IN (SELECT conversation_id FROM (SELECT conversation_id FROM conversation_members WHERE user_id LIKE ?) c)", [like]],
    ["DELETE FROM conversation_members WHERE conversation_id NOT IN (SELECT id FROM conversations)", []],
  ];
  if (gymIds.length) {
    // Tables that only exist after later migrations (gym attendance, gym notices): cleared when present
    // (a notice's recipients go with it)
    const [later] = await conn.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('gym_visits', 'gym_scan_failures', 'gym_notices')");
    for (const { t } of later) steps.push([`DELETE FROM \`${t}\` WHERE gym_id IN (?)`, [gymIds]]);
    steps.push(
      ["DELETE r FROM gym_event_rsvps r JOIN gym_events e ON e.id = r.event_id WHERE e.gym_id IN (?)", [gymIds]],
      ["DELETE FROM gym_events WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM gym_announcements WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM gym_invitations WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM gym_members WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM gym_faqs WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM gym_member_plans WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM whatsapp_agent_settings WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM whatsapp_connections WHERE gym_id IN (?)", [gymIds]],
      ["DELETE FROM gyms WHERE id IN (?)", [gymIds]],
    );
  }
  steps.push(
    ["DELETE FROM gym_event_rsvps WHERE user_id LIKE ?", [like]],
    ["DELETE FROM gym_members WHERE user_id LIKE ?", [like]],
    ["DELETE FROM community_friendships WHERE user_low LIKE ? OR user_high LIKE ?", [like, like]],
    ["DELETE FROM community_profiles WHERE user_id LIKE ?", [like]],
    ["DELETE FROM users WHERE id LIKE ?", [like]],
  );
  for (const [sql, params] of steps) await conn.query(sql, params);

  // Real members' posts the demo members had liked or commented on: counters back in step
  const realPosts = touched.map((t) => t.post_id);
  if (realPosts.length) {
    await conn.query(
      `UPDATE community_posts p SET
         like_count = (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id),
         comment_count = (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL)
       WHERE p.id IN (?)`,
      [realPosts],
    );
  }
  return { gyms: gymIds.length };
}

// After seeding, every post's counters match its rows
async function recount(conn) {
  await conn.query(
    `UPDATE community_posts p SET
       like_count = (SELECT COUNT(*) FROM community_post_likes l WHERE l.post_id = p.id),
       comment_count = (SELECT COUNT(*) FROM community_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL)
     WHERE p.user_id LIKE ? OR p.id IN (SELECT post_id FROM (SELECT post_id FROM community_post_likes WHERE user_id LIKE ? UNION SELECT post_id FROM community_comments WHERE user_id LIKE ?) t)`,
    [`${SEED}%`, `${SEED}%`, `${SEED}%`],
  );
}

async function main() {
  if (command !== "seed" && command !== "remove") {
    console.log("Usage: node scripts/community-demo.js seed --email you@example.com | remove   [--database <name>] [--env-file .env]");
    process.exitCode = 1;
    return;
  }
  const [[{ db }]] = await pool.query("SELECT DATABASE() AS db");
  if (db !== "eato_test" && option("database") !== db) {
    console.error(`This would write to the "${db}" database. Name it to confirm: --database ${db}`);
    process.exitCode = 1;
    await pool.end();
    return;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (command === "seed") {
      const email = option("email");
      if (!email) throw new Error("Pass --email with the justFit account to build the demo around.");
      const [[account]] = await conn.query("SELECT id FROM users WHERE email = ?", [email]);
      if (!account) throw new Error(`No justFit account uses ${email} in ${db} yet. Sign in to the app with it once (and open Community), then run this again.`);
      const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM users WHERE id LIKE ?", [`${SEED}%`]);
      if (n > 0) throw new Error(`${db} already has demo data. Run "remove" first.`);
      await seed(conn, account.id);
      await recount(conn);
      await conn.commit();
      console.log(`Demo Community data added to ${db} around ${email}: ${MEMBERS.length} members, 10 posts, 3 conversations, 2 gyms.`);
    } else {
      const { gyms } = await remove(conn);
      await conn.commit();
      console.log(`Demo Community data removed from ${db} (${gyms} demo gyms and every demo member's rows).`);
    }
  } catch (error) {
    await conn.rollback().catch(() => {});
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
