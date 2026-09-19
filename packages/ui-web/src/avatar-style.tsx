import { createContext, type ReactNode, useContext } from "react";

export type AvatarStyle = "robot" | "organic" | "orb";

const AvatarStyleContext = createContext<AvatarStyle>("orb");

export function AvatarStyleProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AvatarStyle;
}) {
  return <AvatarStyleContext value={value}>{children}</AvatarStyleContext>;
}

export function useAvatarStyle(): AvatarStyle {
  return useContext(AvatarStyleContext);
}
