// Tab-bar icons drawn from plain Views (circles, bars, arcs). The mockup
// uses 22px Feather-style strokes; react-native-svg isn't a dependency, and
// these four shapes are simple enough that bordered Views reproduce them
// closely. All geometry derives from `size` so the icons scale with the
// large-text mode like everything else.
import { View } from "react-native";

export type TabIconName = "list" | "groups" | "grabs" | "you";

export default function TabIcon({
  name,
  color,
  size,
}: {
  name: TabIconName;
  color: string;
  size: number;
}) {
  const t = Math.max(2, Math.round(size * 0.11)); // stroke weight ≈ mockup's 2.5/22

  if (name === "list") {
    return (
      <View
        style={{ width: size, height: size, justifyContent: "space-evenly" }}
        accessibilityElementsHidden
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{ flexDirection: "row", alignItems: "center", gap: size * 0.16 }}
          >
            <View
              style={{ width: t, height: t, borderRadius: t / 2, backgroundColor: color }}
            />
            <View
              style={{ flex: 1, height: t, borderRadius: t / 2, backgroundColor: color }}
            />
          </View>
        ))}
      </View>
    );
  }

  if (name === "you") {
    return (
      <View
        style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}
        accessibilityElementsHidden
      >
        <View
          style={{
            position: "absolute",
            top: 0,
            width: size * 0.44,
            height: size * 0.44,
            borderRadius: size * 0.22,
            borderWidth: t,
            borderColor: color,
          }}
        />
        <View
          style={{
            width: size * 0.78,
            height: size * 0.36,
            borderTopLeftRadius: size * 0.36,
            borderTopRightRadius: size * 0.36,
            borderWidth: t,
            borderBottomWidth: 0,
            borderColor: color,
          }}
        />
      </View>
    );
  }

  if (name === "groups") {
    // Two heads-and-shoulders, the back one peeking out to the right.
    return (
      <View style={{ width: size, height: size }} accessibilityElementsHidden>
        <View
          style={{
            position: "absolute",
            right: 0,
            top: size * 0.08,
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: size * 0.17,
            borderWidth: t,
            borderColor: color,
            opacity: 0.65,
          }}
        />
        <View
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: size * 0.42,
            height: size * 0.28,
            borderTopLeftRadius: size * 0.3,
            borderTopRightRadius: size * 0.3,
            borderWidth: t,
            borderBottomWidth: 0,
            borderColor: color,
            opacity: 0.65,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: size * 0.06,
            top: 0,
            width: size * 0.42,
            height: size * 0.42,
            borderRadius: size * 0.21,
            borderWidth: t,
            borderColor: color,
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 0,
            bottom: 0,
            width: size * 0.62,
            height: size * 0.32,
            borderTopLeftRadius: size * 0.32,
            borderTopRightRadius: size * 0.32,
            borderWidth: t,
            borderBottomWidth: 0,
            borderColor: color,
          }}
        />
      </View>
    );
  }

  // grabs: a gift box — lid bar, box, vertical ribbon.
  return (
    <View style={{ width: size, height: size, alignItems: "center" }} accessibilityElementsHidden>
      <View
        style={{
          width: size,
          height: size * 0.26,
          borderWidth: t,
          borderColor: color,
          borderRadius: t,
        }}
      />
      <View
        style={{
          width: size * 0.8,
          flex: 1,
          marginTop: size * 0.06,
          borderWidth: t,
          borderColor: color,
          borderBottomLeftRadius: t,
          borderBottomRightRadius: t,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: t,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
