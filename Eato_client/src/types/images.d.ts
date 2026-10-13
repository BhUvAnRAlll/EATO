// Lets TypeScript understand image imports like `import logo from "@/assets/images/logo.png"`.
declare module "*.png" {
  import type { ImageSourcePropType } from "react-native";

  const source: ImageSourcePropType;
  export default source;
}

declare module "*.jpg" {
  import type { ImageSourcePropType } from "react-native";

  const source: ImageSourcePropType;
  export default source;
}
