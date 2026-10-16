# The admin side

## What FORMA actually has

Very little, and it is worth saying plainly before you plan admin work:

1. **No staff screen shows a member's nutrition.** No admin, manager or trainer
   screen renders calories, macros, meals, water or targets. Nutrition is
   private to the member who logged it.
2. **No staff role can set a member's target.** Every target operation resolves
   the member from their own session and refuses anyone else. There is no
   staff-side override, by design: the member owns their numbers.
3. **The recipe library has no editor.** The sidebar has an "Upload Recipe" row,
   but it has no screen behind it — tapping it says *"This is coming soon."*
   The library is seeded from the command line. (Recipes are out of scope for
   your build anyway.)
4. **One indirect touch point.** The manager's report counts whether a member
   logged *a* meal or workout in a period, to compute an app-usage figure. It
   reads only that a meal row exists — never its contents.

So: nutrition in FORMA is a member-only feature with an aggregate usage flag,
and nothing else.

## What this means for your app

You have one staff role. If you want any admin involvement in nutrition, these
are the options, smallest first. None of them exists in FORMA — building any of
them is new work, not a port.

### Engagement reporting (closest to what FORMA does)
Count members who logged at least one meal or water entry in a period. No
contents, no per-member detail. Cheap, and it answers *"is anyone using this?"*

### A food library the admin curates
If your members log the same foods repeatedly, an admin-managed list of foods
with their per-serving macros turns manual entry into a search-and-tap. This is
the highest-value admin feature for a nutrition module:
- Store: `name`, optional `brand`, serving size and unit, and the four numbers.
- Admin screens: list with search, create/edit form, archive (never hard-delete
  what members have logged against).
- Member side: a search step in front of Manual entry that pre-fills the form.

### Per-member oversight — think before you build it
A coach seeing a client's food log is a real feature, but it is also a privacy
decision:
- Gate it on the member's explicit consent, not on the staff role alone.
- Scope it to that staff member's own clients.
- Show it read-only — a coach advising is different from a coach editing
  someone's record.
- Keep an audit trail of who looked.

If you do build it, the member-facing reads already return everything a coach
would need (`day`, `periodSummary`); they only need a server-side path that
takes a member id **after** those checks, rather than reading the caller's own
id.

### What not to do
Do not let an admin set a member's calorie target directly. FORMA deliberately
has no such path: the number is either calculated from the member's body or
typed by the member. A target someone else sets, which the app then silently
recalculates away, is a support ticket waiting to happen.
