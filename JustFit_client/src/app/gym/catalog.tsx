import { CatalogList } from "@/components/gym/CatalogList";
import { GymSectionScreen } from "@/components/gym/GymSectionScreen";

// Gym admin › Plans / Catalogue (Home's + › Add Plan, the ☰ menu, the forms' "Add prices" link)
export default function GymCatalog() {
  return (
    <GymSectionScreen title="Plans / Catalogue" need="catalog.view">
      <CatalogList />
    </GymSectionScreen>
  );
}
