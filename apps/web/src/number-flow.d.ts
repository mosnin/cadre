import type { HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "number-flow": HTMLAttributes<HTMLElement>;
    }
  }
}
