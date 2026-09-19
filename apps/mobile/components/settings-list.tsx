import { Children, Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { native, useThemedStyles } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

/** Inset grouped list, in the style of the platform settings app. */
export function SettingsGroup({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.card}>
        {Children.toArray(children)
          .filter(Boolean)
          .map((child, index) => (
            <Fragment key={index}>
              {index > 0 ? <View style={styles.separator} /> : null}
              {child}
            </Fragment>
          ))}
      </View>
      {footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
    </View>
  );
}

export function SettingsRow({
  title,
  detail,
  value,
  onPress,
  disabled,
  chevron = Boolean(onPress),
  checked,
  destructive,
  accessibilityLabel,
  leading,
  trailing,
}: {
  title: string;
  detail?: string;
  value?: string | null;
  onPress?: () => void;
  disabled?: boolean;
  chevron?: boolean;
  checked?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  const content = (
    <>
      {leading}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.title, destructive && styles.destructive]}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={styles.detail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {checked ? <NativeSymbol ios="checkmark" android="checkmark" size={17} /> : null}
      {chevron ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );
  if (!onPress) {
    return (
      <View accessibilityLabel={accessibilityLabel} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: checked }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {content}
    </Pressable>
  );
}

export function SettingsSwitchRow({
  title,
  detail,
  value,
  disabled,
  onChange,
}: {
  title: string;
  detail?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={styles.detail}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={detail}
        disabled={disabled}
        value={value}
        onValueChange={onChange}
      />
    </View>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    group: {
      gap: 6,
    },
    groupTitle: {
      color: native.secondaryLabel,
      fontSize: 13,
      textTransform: "uppercase",
      paddingHorizontal: 16,
    },
    groupFooter: {
      color: native.secondaryLabel,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 16,
    },
    card: {
      borderRadius: 12,
      backgroundColor: native.fill,
      overflow: "hidden",
    },
    row: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    rowText: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      color: native.label,
      fontSize: 17,
    },
    detail: {
      color: native.secondaryLabel,
      fontSize: 13,
      marginTop: 2,
    },
    value: {
      color: native.secondaryLabel,
      fontSize: 16,
      flexShrink: 1,
      maxWidth: "50%",
    },
    chevron: {
      color: native.tertiaryLabel,
      fontSize: 24,
      fontWeight: "300",
      marginTop: -2,
    },
    destructive: {
      color: tokens.destructive,
    },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: native.tertiaryLabel,
      marginLeft: 16,
    },
    pressed: {
      backgroundColor: native.fillPressed,
    },
    disabled: {
      opacity: 0.5,
    },
  });
}
