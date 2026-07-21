// Invite + join (spec §3). One screen with both halves, because they're two
// ends of the same act and the app has no navigator — ListScreen swaps this in
// as a full-screen view and takes it back on close.
//
// Delivery is the OS share sheet: create_invite mints the code, the user sends
// it however they already talk to the person. The invite is tied to the group,
// not the sender, so it stays valid if the inviter later leaves.
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { base, colors, groupPalette } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";
import type { GroupInfo } from "@/hooks/useCartpool";
import type { RpcResult } from "@/api/rpc";

const CODE_LENGTH = 8;
// Same alphabet create_invite generates from: base32 minus 0/O/1/I.
const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;

export default function ShareScreen({
  groups,
  groupTitle,
  memberCount,
  scale: s,
  onCreateInvite,
  onRedeem,
  onClose,
}: {
  groups: GroupInfo[];
  groupTitle: (groupId: string) => string;
  memberCount: (groupId: string) => number;
  scale: number;
  onCreateInvite: (groupId: string) => Promise<RpcResult<{ code: string; link: string }>>;
  onRedeem: (
    code: string
  ) => Promise<RpcResult<{ joined?: boolean; waitlisted?: boolean; group_id?: string }>>;
  onClose: () => void;
}) {
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  const invite = async (groupId: string) => {
    setBusyGroup(groupId);
    try {
      const res = await onCreateInvite(groupId);
      if (!res.ok) {
        Alert.alert("Couldn't create an invite", friendlyInviteError(res.error));
        return;
      }
      // Both code and link: the link is for anyone who can tap it, the code is
      // the fallback for someone typing it into the app by hand.
      await Share.share({
        message: `Join my Cartpool list: ${res.link}\n\nOr enter code ${res.code} in the app. The invite works for 7 days.`,
      });
    } catch (e: any) {
      // A dismissed share sheet is not an error; a thrown RPC is.
      if (e?.message) Alert.alert("Couldn't create an invite", e.message);
    } finally {
      setBusyGroup(null);
    }
  };

  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codeLooksValid =
    normalized.length === CODE_LENGTH && CODE_ALPHABET.test(normalized);

  const join = async () => {
    if (!codeLooksValid || joining) return;
    setJoining(true);
    try {
      const res = await onRedeem(normalized);
      if (!res.ok) {
        Alert.alert("Couldn't join", friendlyRedeemError(res.error));
        return;
      }
      setCode("");
      if (res.waitlisted) {
        // Not a failure: the group was full, so the request is queued and
        // promoted first-come-first-served when someone leaves (spec §3).
        Alert.alert(
          "You're on the waitlist",
          "That group is full right now. You'll be added automatically as soon as a spot opens, in the order requests came in."
        );
      } else {
        Alert.alert(
          "You're in",
          "The group's list is on your home screen now. If this was your first shared group, your own items moved across with you."
        );
        onClose();
      }
    } catch (e: any) {
      Alert.alert("Couldn't join", e?.message ?? String(e));
    } finally {
      setJoining(false);
    }
  };

  const groupColor = (groupId: string) =>
    groupPalette[groups.findIndex((g) => g.id === groupId) % groupPalette.length];

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text
          style={[styles.headerTitle, { fontSize: base.fontSizeTitle * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Share a list
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

      <ScrollView
        contentContainerStyle={{ paddingBottom: base.spacing * 4 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text
          style={[styles.sectionLabel, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Invite someone
        </Text>
        <Text
          style={[styles.help, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Up to four people can share one list. Invites last 7 days.
        </Text>

        {groups.map((g) => {
          const full = memberCount(g.id) >= 4;
          return (
            <Pressable
              key={g.id}
              onPress={() => invite(g.id)}
              disabled={busyGroup !== null}
              style={({ pressed }) => [
                styles.groupRow,
                { minHeight: base.rowMinHeight * s },
                pressed && { backgroundColor: colors.surface },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Invite someone to ${groupTitle(g.id)}`}
            >
              <View style={[styles.colorDot, { backgroundColor: groupColor(g.id) }]} />
              <View style={styles.groupRowBody}>
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
                  {memberCount(g.id)} of 4 members
                  {full ? " · full, new joiners are waitlisted" : ""}
                </Text>
              </View>
              {busyGroup === g.id ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: base.fontSizeSmall * s,
                    fontWeight: "700",
                  }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  Invite
                </Text>
              )}
            </Pressable>
          );
        })}

        <View style={styles.divider} />

        <Text
          style={[styles.sectionLabel, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Join a list
        </Text>
        <Text
          style={[styles.help, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Enter the 8-character code someone sent you.
        </Text>

        <View style={styles.joinRow}>
          <TextInput
            style={[
              styles.codeInput,
              { fontSize: (base.fontSize + 1) * s, minHeight: base.tapTarget * s },
            ]}
            placeholder="ABCD2345"
            placeholderTextColor={colors.textSecondary}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            onSubmitEditing={join}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={12}
            returnKeyType="go"
            accessibilityLabel="Invite code"
          />
          <Pressable
            onPress={join}
            disabled={!codeLooksValid || joining}
            style={[
              styles.joinButton,
              { minHeight: base.tapTarget * s },
              (!codeLooksValid || joining) && { opacity: 0.4 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Join list"
          >
            {joining ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text
                style={{
                  color: colors.accentText,
                  fontSize: base.fontSizeSmall * s,
                  fontWeight: "700",
                }}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                Join
              </Text>
            )}
          </Pressable>
        </View>

        <Text
          style={[styles.help, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Joining your first shared list brings your own items along with you.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function friendlyInviteError(code: string): string {
  switch (code) {
    case "not_a_member":
      return "You're not a member of that list anymore.";
    case "read_only":
      return "Your account is read-only right now (subscription lapsed).";
    default:
      return `Something went wrong (${code}).`;
  }
}

function friendlyRedeemError(code: string): string {
  switch (code) {
    case "invalid":
      return "That code doesn't match any list. Check it and try again.";
    case "expired":
      return "That invite has expired or been revoked. Ask for a new one.";
    case "already_member":
      return "You're already in that list.";
    case "group_limit":
      // The free tier allows 3 groups; joining a 4th needs a subscription.
      return "You're in 3 lists already, which is the free limit. Leave one, or subscribe for unlimited lists.";
    case "not_available":
      // Deliberately vague: the co-placement bar is silent on both sides
      // (spec §3), so this must not reveal that a block exists.
      return "That invite isn't available.";
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
  headerTitle: { fontWeight: "700", color: colors.accent },
  headerButton: {
    minHeight: base.tapTarget,
    minWidth: base.tapTarget,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing,
    paddingBottom: 4,
  },
  help: {
    color: colors.textSecondary,
    paddingHorizontal: base.spacing,
    paddingBottom: base.spacing / 2,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: base.spacing,
    paddingHorizontal: base.spacing,
    paddingVertical: 6,
  },
  groupRowBody: { flex: 1, gap: 2 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: base.spacing,
    marginHorizontal: base.spacing,
  },
  joinRow: {
    flexDirection: "row",
    gap: base.spacing / 2,
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing / 2,
  },
  codeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    color: colors.text,
    backgroundColor: colors.surface,
    letterSpacing: 2,
  },
  joinButton: {
    backgroundColor: colors.accent,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing * 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
});
