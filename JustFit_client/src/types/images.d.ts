// Lets TypeScript understand image imports like `import logo from "@/assets/images/logo.png"`.
// Metro turns an imported image into an asset id (a number), which React Native's Image and
// expo-image both accept as a source.
declare module "*.png" {
  const source: number;
  export default source;
}

declare module "*.jpg" {
  const source: number;
  export default source;
}
