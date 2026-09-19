import { useEffect } from "react";
import type { StyleProp, TextStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

/**
 * Native stand-in for ElevenLabs shimmering-text (`components add shimmering-text`).
 * The official component is Motion/CSS; phones get the same sweep via opacity.
 */
export function ShimmeringText({
  text,
  style,
  once = false,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  const progress = useSharedValue(reduce ? 1 : 0);

  useEffect(() => {
    if (reduce) {
      progress.value = 1;
      return;
    }
    if (once) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 2000, easing: Easing.linear });
      return;
    }
    progress.value = withRepeat(
      withDelay(500, withTiming(1, { duration: 2000, easing: Easing.linear })),
      -1,
      true,
    );
  }, [once, progress, reduce]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 0.42 + progress.value * 0.58,
  }));

  return (
    <Animated.Text style={[style, animatedStyle]} accessibilityLiveRegion="polite">
      {text}
    </Animated.Text>
  );
}
