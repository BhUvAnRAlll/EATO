// Staff / Admin Login (2026-11-05): the gym admin's team at the open branch. Adding a number that
// has a justFit account links it and changes its role at once (Staff → gym_admin, Trainer →
// trainer); a number that has never signed in waits as an invite and joins at its first sign-in
// (applyInvites, inside the sign-in transaction). Removing someone from their last branch makes
// them a member again. Every change is in one transaction and written to the admin audit log.
// The rules are in staffRules.js; only the gym admin (kind 'owner') reaches these (gym/routes.js).
const { NotFoundError, ConflictError } = require("../errors");
const { audit } = require("../admin/overview");
const rules = require("./staffRules");
const { inTransaction } = require("./service");

const dayOf = (value) => (value ? new Date(value).toISOString() : null);

// The branch's team (the gym admin first) and its open invites. Numbers are masked.
async function team(pool, gym, callerId) {
  const [people] = await pool.query(
    `SELECT s.user_id, s.kind, s.added_at, u.full_name, u.verified_phone
       FROM gym_staff s JOIN users u ON u.id = s.user_id
      WHERE s.gym_id = ? ORDER BY FIELD(s.kind, 'owner', 'staff', 'trainer'), s.added_at, s.user_id`,
    [gym.id],
  );
  const [invites] = await pool.query("SELECT id, phone, kind, created_at FROM gym_staff_invites WHERE gym_id = ? ORDER BY created_at, id", [gym.id]);
  return {
    gym: { name: gym.brand, branch: gym.branch },
    team: people.map((p) => ({
      id: p.user_id,
      name: (p.full_name && p.full_name.trim()) || null,
      phone: rules.maskPhone(p.verified_phone),
      kind: p.kind,
      addedAt: dayOf(p.added_at),
      you: p.user_id === callerId,
    })),
    invites: invites.map((i) => ({ id: i.id, phone: rules.maskPhone(i.phone), kind: i.kind, invitedAt: dayOf(i.created_at) })),
  };
}

// The branches an account works at (locked while its team rows change)
async function linksOf(db, userId) {
  const [rows] = await db.query(
    "SELECT s.gym_id, s.kind, g.brand_id FROM gym_staff s JOIN gyms g ON g.id = s.gym_id WHERE s.user_id = ? FOR UPDATE",
    [userId],
  );
  return rows.map((r) => ({ gymId: r.gym_id, brandId: r.brand_id, kind: r.kind }));
}

// Joins the account to the branch and gives it the kind's role (in the caller's transaction)
async function link(db, userId, gymId, kind, currentRole) {
  await db.query("INSERT INTO gym_staff (user_id, gym_id, kind) VALUES (?, ?, ?)", [userId, gymId, kind]);
  const role = rules.ROLE_FOR[kind];
  if (currentRole !== role) await db.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
}

// Adds a number as Staff or Trainer. Answers { result: "added" | "invited", ...team }
async function add(pool, gym, callerId, { phone, kind }) {
  const target = { id: gym.id, brandId: gym.brand_id };
  const where = `${gym.brand}, ${gym.branch} branch`;
  const result = await inTransaction(pool, async (db) => {
    const [[account]] = await db.query("SELECT id, role FROM users WHERE verified_phone = ? FOR UPDATE", [phone]);
    if (account) {
      rules.checkJoin(account, await linksOf(db, account.id), target, kind);
      await link(db, account.id, gym.id, kind, account.role);
      await audit(db, callerId, "gym.staff_add", "gym", gym.id, `The gym admin added ${rules.KIND_LABEL[kind]} to ${where}`);
      return "added";
    }
    const [invites] = await db.query(
      "SELECT i.gym_id, i.kind, g.brand_id FROM gym_staff_invites i JOIN gyms g ON g.id = i.gym_id WHERE i.phone = ? FOR UPDATE",
      [phone],
    );
    const problem = rules.inviteProblem(invites.map((i) => ({ gymId: i.gym_id, brandId: i.brand_id, kind: i.kind })), target, kind);
    if (problem) throw new ConflictError(problem);
    try {
      await db.query("INSERT INTO gym_staff_invites (gym_id, phone, kind, invited_by) VALUES (?, ?, ?, ?)", [gym.id, phone, kind, callerId]);
    } catch (error) {
      if (error?.code === "ER_DUP_ENTRY") throw new ConflictError("They've already been invited.");
      throw error;
    }
    await audit(db, callerId, "gym.staff_invite", "gym", gym.id, `The gym admin invited ${rules.KIND_LABEL[kind]} to ${where}`);
    return "invited";
  });
  return { result, ...(await team(pool, gym, callerId)) };
}

// Takes someone off this branch's team. From their last branch they become a member again; a
// trainer's PT members here are left without a trainer.
async function remove(pool, gym, callerId, userId) {
  await inTransaction(pool, async (db) => {
    const [[account]] = await db.query("SELECT id, role FROM users WHERE id = ? FOR UPDATE", [userId]);
    const links = account ? await linksOf(db, userId) : [];
    const here = links.find((l) => l.gymId === gym.id);
    if (!here) throw new NotFoundError("They aren't on your team.");
    const problem = rules.removeProblem(callerId, { userId, kind: here.kind });
    if (problem) throw new ConflictError(problem);
    await db.query("DELETE FROM gym_staff WHERE user_id = ? AND gym_id = ?", [userId, gym.id]);
    if (here.kind === "trainer") await db.query("UPDATE gym_members SET pt_trainer_id = NULL WHERE gym_id = ? AND pt_trainer_id = ?", [gym.id, userId]);
    const role = rules.roleAfterLeaving(account.role, links.length - 1);
    if (role !== account.role) await db.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
    await audit(db, callerId, "gym.staff_remove", "gym", gym.id, `The gym admin removed ${rules.KIND_LABEL[here.kind]} from ${gym.brand}, ${gym.branch} branch`);
  });
  return team(pool, gym, callerId);
}

async function cancelInvite(pool, gym, callerId, inviteId) {
  await inTransaction(pool, async (db) => {
    const [deleted] = await db.query("DELETE FROM gym_staff_invites WHERE id = ? AND gym_id = ?", [inviteId, gym.id]);
    if (deleted.affectedRows === 0) throw new NotFoundError("That invite has already gone.");
    await audit(db, callerId, "gym.staff_invite_cancel", "gym", gym.id, `The gym admin cancelled an invite to ${gym.brand}, ${gym.branch} branch`);
  });
  return team(pool, gym, callerId);
}

// At sign-in, inside verifyOtp's transaction (`db`), after the code proved `phone`: the number's
// invites join it to those branches and give it the role. An invite that can no longer apply (the
// account became an admin, or works at another gym) is dropped. Before the migration has run
// there is nothing to apply.
async function applyInvites(db, userId, phone) {
  let invites;
  try {
    [invites] = await db.query(
      "SELECT i.id, i.gym_id, i.kind, i.invited_by, g.brand_id FROM gym_staff_invites i JOIN gyms g ON g.id = i.gym_id WHERE i.phone = ? ORDER BY i.id FOR UPDATE",
      [phone],
    );
  } catch (error) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) return;
    throw error;
  }
  if (invites.length === 0) return;
  const [[account]] = await db.query("SELECT role FROM users WHERE id = ? FOR UPDATE", [userId]);
  let role = account.role;
  const links = await linksOf(db, userId);
  for (const invite of invites) {
    const gym = { id: invite.gym_id, brandId: invite.brand_id };
    if (rules.joinProblem({ role }, links, gym, invite.kind)) continue;
    await link(db, userId, invite.gym_id, invite.kind, role);
    role = rules.ROLE_FOR[invite.kind];
    links.push({ gymId: invite.gym_id, brandId: invite.brand_id, kind: invite.kind });
    await audit(db, invite.invited_by, "gym.staff_join", "gym", invite.gym_id, `An invited ${rules.KIND_LABEL[invite.kind]} signed in and joined the team`);
  }
  await db.query("DELETE FROM gym_staff_invites WHERE phone = ?", [phone]);
}

module.exports = { team, add, remove, cancelInvite, applyInvites };
