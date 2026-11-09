import type { AddressKind } from "@/lib/addressRules";
import type { Icon } from "@/types/profile";

// Each address type's icon (SF Symbol on iOS, Material Symbol on Android and the web)
export const KIND_ICON: Record<AddressKind, Icon> = {
  home: { ios: "house.fill", android: "home", web: "home" },
  work: { ios: "briefcase.fill", android: "work", web: "work" },
  other: { ios: "mappin.circle.fill", android: "location_on", web: "location_on" },
};
