declare module "*.mdx" {
  import type { ComponentType } from "react";

  export const metadata: unknown;
  const MDXComponent: ComponentType;
  export default MDXComponent;
}
