import { BotAvatar } from "@cadre/ui-web";
import { createRoot } from "react-dom/client";
// The assertion is about CSS, so the stylesheet has to be here. The page
// this renders into is not the app, and the old fixture inherited nothing:
// its "animationName is none" would have passed with no styles at all.
import "../../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <BotAvatar color="#D9508A" size={120} status="running" />,
);
