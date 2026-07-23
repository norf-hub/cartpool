// The sliding bottom sheet from the mockup: a dimmed backdrop with a
// rounded panel that animates up from the bottom, a grab handle, and a close
// (✕) button. Replaces the Alert-based action menus. Tapping the backdrop or
// the ✕ dismisses; content is provided by children.
//
// Built on RN's Modal so it floats above the tab bar and captures the back
// button on Android. The panel is capped at 88% height and scrolls if its
// content is taller, matching the mockup.
import { useEffect, useRef } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export default function BottomSheet({
  visible,
  onClose,
  title,
  scale: s,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Optional accessible label for the sheet as a whole. */
  title?: string;
  scale: number;
  children: React.ReactNode;
}) {
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  // Android hardware back closes the sheet rather than the whole screen.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View style={[styles.backdrop, { opacity: slide }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
        />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          accessibilityViewIsModal
          accessibilityLabel={title}
        >
          <View style={styles.grabHandle} />
          <Pressable
            onPress={onClose}
            style={[styles.closeX, { minWidth: 34 * s, minHeight: 34 * s }]}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={8}
          >
            <Text
              style={{ color: colors.textSecondary, fontSize: 18 * s, fontFamily: fonts.body }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              ✕
            </Text>
          </Pressable>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(46,43,37,0.46)", // neutral-900 @ 46%
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 30,
  },
  grabHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginTop: 6,
    marginBottom: 16,
  },
  closeX: {
    position: "absolute",
    right: 4,
    top: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingBottom: 8 },
});
