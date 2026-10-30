// Video files imported as assets (the bundler turns them into an asset id, like images)
declare module "*.mp4" {
  const source: number;
  export default source;
}
