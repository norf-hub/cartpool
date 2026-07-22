// The required downgrade selection (spec §9): entitlement lapsed with more
// than 3 groups, so the account is read-only everywhere until exactly 3 are
// chosen to keep. Deliberately unescapable — no close button, and ListScreen
// re-renders it on every app open while frozen_read_only holds. Nothing is
// deleted: the excess groups stay read-only and come back whole after the
// one-time unlock purchase (v3.1).
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { base, colors, groupPalette } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";
import type { GroupInfo } from "@/hooks/useCartpool";
import type { RpcResult } from "@/api/rpc";

const KEEP = 3;

export default function ChooseGroupsScreen({
  groups,
  groupTitle,
  scale: s,
  onConfirm,
  onResubscribe,
}: {
  groups: GroupInfo[];
  groupTitle: (groupId: string) => string;
  scale: number;
  onConfirm: (groupIds: string[]) => Promise<RpcResult>;
  /** Paywall entry — stubbed until RevenueCat is configured (INFRA §5). */
  onResubscribe: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < KEEP) {
        next.add(id);
      }
      // Silently ignore a 4th pick; the counter makes the limit visible.
      return next;
    });
  };

  const confirm = async () => {
    if (picked.size !== KEEP || busy) return;
    setBusy(true);
    try {
      const res = await onConfirm([...picked]);
      if (!res.ok) {
        Alert.alert("Couldn't save", friendly(res.error));
      }
      // On success the frozen flag lifts server-side; the refresh in the
      // action wrapper re-renders ListScreen out of this screen.
    } finally {
      setBusy(false);
    }
  };

  const groupColor = (groupId: string) =>
    groupPalette[groups.findIndex((g) => g.id === groupId) % groupPalette.length];

  return (
    <View style={styles.root}>
      <Text
        style={[styles.title, { fontSize: base.fontSizeTitle * s }]}
        maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
      >
        Choose 3 lists to keep
      </Text>
      <Text
        style={[styles.body, { fontSize: base.fontSize * s }]}
        maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
      >
        Your 3 free months are up, and the free plan includes 3 lists. Pick the
        3 to keep using. The others aren't deleted — they become read-only, and
        everything comes back if you unlock unlimited lists.
      </Text>

      <ScrollView contentContainerStyle={{ paddingBottom: base.spacing * 2 }}>
        {groups.map((g) => {
          const on = picked.has(g.id);
          return (
            <Pressable
              key={g.id}
              onPress={() => toggle(g.id)}
              style={[
                styles.row,
                { minHeight: base.rowMinHeight * s },
                on && { backgroundColor: colors.surface },
              ]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Keep ${groupTitle(g.id)}`}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    width: base.tapTarget * 0.6 * s,
                    height: base.tapTarget * 0.6 * s,
                    borderColor: groupColor(g.id),
                  },
                  on && { backgroundColor: groupColor(g.id) },
                ]}
              >
                {on && (
                  <Text style={{ color: colors.accentText, fontSize: base.fontSize * 0.8 * s }}>
                    ✓
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  style={{ fontSize: base.fontSize * s, color: colors.text }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  {groupTitle(g.id)}
                </Text>
                <Text
                  style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  {g.memberIds.length} {g.memberIds.length === 1 ? "member" : "members"}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Text
          style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          {picked.size} of {KEEP} chosen
        </Text>
        <Pressable
          onPress={confirm}
          disabled={picked.size !== KEEP || busy}
          style={[
            styles.confirm,
            { minHeight: base.tapTarget * s },
            (picked.size !== KEEP || busy) && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Keep these ${KEEP} lists`}
        >
          {busy ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text
              style={{
                color: colors.accentText,
                fontSize: base.fontSize * s,
                fontWeight: "700",
              }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Keep these {KEEP}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={onResubscribe}
          style={[styles.resub, { minHeight: base.tapTarget * s }]}
          accessibilityRole="button"
          accessibilityLabel="Unlock unlimited lists instead and keep them all"
        >
          <Text
            style={{ color: colors.accent, fontSize: base.fontSizeSmall * s, fontWeight: "600" }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Or unlock unlimited lists ($10, one time) and keep them all
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function friendly(code: string): string {
  switch (code) {
    case "must_pick_exactly_3":
      return "Pick exactly 3 lists.";
    case "not_frozen":
      // Webhook already cleared it (purchased on another device, say);
      // the refresh will dismiss this screen on its own.
      return "Looks like this is already sorted — one moment.";
    case "not_a_member":
      return "One of those lists is no longer yours. The list has refreshed — pick again.";
    default:
      return `Something went wrong (${code}).`;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  title: {
    fontWeight: "700",
    color: colors.text,
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing,
  },
  body: {
    color: colors.textSecondary,
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: base.spacing,
    paddingHorizontal: base.spacing,
    paddingVertical: 6,
  },
  checkbox: {
    borderWidth: 2,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: base.spacing,
    gap: base.spacing / 2,
    alignItems: "center",
  },
  confirm: {
    backgroundColor: colors.accent,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing * 2,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  resub: { alignItems: "center", justifyContent: "center" },
});
