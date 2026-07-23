// Group management (spec §3): per-list member roster, leave, and block.
// Full-screen swap from ListScreen, like ShareScreen.
//
// Blocking is the delicate one. The server makes the blocker leave every
// shared list; the blocked person is never notified, and the blocks table is
// invisible to clients (no RLS policy), so there is deliberately no
// "blocked users" list here and no post-block state to show. The confirm
// dialog carries the full consequences because there's no undo surface.
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
import { base, colors, fonts, groupPalette } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";
import type { GroupInfo } from "@/hooks/useCartpool";
import type { RpcResult } from "@/api/rpc";

export default function GroupsScreen({
  groups,
  userId,
  groupTitle,
  nameOf,
  scale: s,
  onLeave,
  onBlock,
  onClose,
}: {
  groups: GroupInfo[];
  userId: string;
  groupTitle: (groupId: string) => string;
  nameOf: (id: string | null) => string;
  scale: number;
  onLeave: (groupId: string) => Promise<RpcResult>;
  onBlock: (targetUserId: string) => Promise<RpcResult>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const groupColor = (groupId: string) =>
    groupPalette[groups.findIndex((g) => g.id === groupId) % groupPalette.length];

  const confirmLeave = (g: GroupInfo) => {
    const lastMember = g.memberIds.length === 1;
    Alert.alert(
      `Leave ${groupTitle(g.id)}?`,
      lastMember
        ? "You're the last member, so the list and everything on it will be deleted."
        : "Your unbought items disappear from this list for everyone. Items of yours that someone already bought stay visible for 2 days so they can settle up.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const res = await onLeave(g.id);
              if (!res.ok) Alert.alert("Couldn't leave", friendly(res.error));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const confirmBlock = (targetId: string) => {
    Alert.alert(
      `Block ${nameOf(targetId)}?`,
      "You'll leave every list you share with them (your unbought items on those lists disappear). Neither of you will be able to join a list the other is in. They won't be notified, and this can't be undone in the app.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              const res = await onBlock(targetId);
              if (!res.ok) Alert.alert("Couldn't block", friendly(res.error));
              // No success state on purpose: after this the shared lists are
              // simply gone from the home screen, and blocks are invisible.
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text
          style={[styles.headerTitle, { fontSize: base.fontSizeTitle * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Your lists
        </Text>
        <Pressable
          onPress={onClose}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text
            style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Done
          </Text>
        </Pressable>
      </View>

      {busy && <ActivityIndicator color={colors.accent} />}

      <ScrollView contentContainerStyle={{ paddingBottom: base.spacing * 4 }}>
        {groups.map((g) => (
          <View key={g.id} style={styles.groupCard}>
            <View style={styles.groupHeader}>
              <View style={[styles.colorDot, { backgroundColor: groupColor(g.id) }]} />
              <Text
                style={[styles.groupTitle, { fontSize: base.fontSize * s }]}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                {groupTitle(g.id)}
              </Text>
              <Pressable
                onPress={() => confirmLeave(g)}
                disabled={busy}
                style={[styles.leaveButton, { minHeight: base.tapTarget * s }]}
                accessibilityRole="button"
                accessibilityLabel={`Leave ${groupTitle(g.id)}`}
              >
                <Text
                  style={{
                    color: colors.danger,
                    fontSize: base.fontSizeSmall * s,
                    fontWeight: "600",
                  }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  Leave
                </Text>
              </Pressable>
            </View>

            {g.memberIds.map((id) => (
              <View key={id} style={[styles.memberRow, { minHeight: base.rowMinHeight * s }]}>
                <Text
                  style={{ fontSize: base.fontSize * s, color: colors.text, flex: 1 }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  {id === userId ? "You" : nameOf(id)}
                </Text>
                {id !== userId && (
                  <Pressable
                    onPress={() => confirmBlock(id)}
                    disabled={busy}
                    style={[styles.blockButton, { minHeight: base.tapTarget * s }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Block ${nameOf(id)}`}
                  >
                    <Text
                      style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
                      maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                    >
                      Block
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ))}

        <Text
          style={[styles.footnote, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Lists hold up to 4 people. No one can remove anyone else — leaving is
          always your own choice.
        </Text>
      </ScrollView>
    </View>
  );
}

function friendly(code: string): string {
  switch (code) {
    case "not_a_member":
      return "You're not in that list anymore.";
    case "read_only":
      return "Your account is read-only right now (subscription lapsed).";
    default:
      return `Something went wrong (${code}).`;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing / 2,
  },
  headerTitle: { fontFamily: fonts.heading, color: colors.accent },
  headerButton: {
    minHeight: base.tapTarget,
    minWidth: base.tapTarget,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  groupCard: {
    marginHorizontal: base.spacing,
    marginTop: base.spacing,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    backgroundColor: colors.surface,
    paddingBottom: 4,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing / 2,
  },
  groupTitle: { fontWeight: "700", color: colors.text, flex: 1 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  leaveButton: {
    minWidth: base.tapTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: base.spacing / 2,
  },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: base.spacing,
  },
  blockButton: {
    minWidth: base.tapTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: base.spacing / 2,
  },
  footnote: {
    color: colors.textSecondary,
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing,
  },
});
