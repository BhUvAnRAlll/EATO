// Content tab: the Home promotions list (app/admin/promotions) until its rework to the
// mockup lands in a later phase of the Super Admin portal. As a tab root it has no back arrow.
import AdminPromotions from "../promotions/index";

export default function AdminContentTab() {
  return <AdminPromotions tab />;
}
