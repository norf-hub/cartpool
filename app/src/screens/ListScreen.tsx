// The merged list (spec §2): every group's items in one screen, sections per
// group with a color tag. Core-loop actions only — add, mark purchased
// (1 tap, no dialog), unmark (buyer only), edit/remove (adder only).
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { parseInviteUrl } from "@/lib/links";
import { useAuth } from "@/hooks/useAuth";
import { useCartpool, type BulkOptIn, type Item } from "@/hooks/useCartpool";
import ShareScreen from "@/screens/ShareScreen";
import { base, colors, groupPalette } from "@/theme";
import { LARGE_TEXT_SCALE, MAX_OS_FONT_SCALE } from "@/theme/accessibility";

type Section = { groupId: string; color: string; title: string; data: Item[] };

// getInitialURL keeps returning the launch URL for the whole app run, so a
// remount (sign out and back in) would re-open the share view with a stale
// code. Module-level because the consumption must outlive the component.
let consumedInitialUrl: string | null = null;

export default function ListScreen({ userId }: { userId: string }) {
  const { signOut } = useAuth();
  const cp = useCartpool(userId);
  const [draft, setDraft] = useState("");
  const [draftBulk, setDraftBulk] = useState(false);
  const [targetGroup, setTargetGroup] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [sharing, setSharing] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  // Invite deep links land here: prefill the join field and open the share
  // view. Never auto-redeem — the user must actively accept (spec §3).
  // getInitialURL covers cold start via link (including a link tapped before
  // sign-in, since this mounts right after auth); the listener covers links
  // tapped while the app is running.
  useEffect(() => {
    const handle = (url: string | null) => {
      const c = parseInviteUrl(url);
      if (c) {
        setPendingCode(c);
        setSharing(true);
      }
    };
    Linking.getInitialURL().then((url) => {
      if (url && url !== consumedInitialUrl) {
        consumedInitialUrl = url;
        handle(url);
      }
    });
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  // In-app large-text toggle: fixed scale on text AND row height together
  // (addendum §4.1). OS font scaling stacks on top, capped at 2.0.
  const s = cp.profile?.large_text_mode ? LARGE_TEXT_SCALE : 1;

  const groupColor = (groupId: string) =>
    groupPalette[cp.groups.findIndex((g) => g.id === groupId) % groupPalette.length];

  const groupTitle = (groupId: string) => {
    const g = cp.groups.find((x) => x.id === groupId);
    if (!g) return "List";
    const others = g.memberIds.filter((id) => id !== userId).map((id) => cp.nameOf(id));
    return others.length === 0 ? "My list" : `With ${others.join(", ")}`;
  };

  const sections: Section[] = useMemo(
    () =>
      cp.groups.map((g) => {
        const inGroup = cp.items.filter((i) => i.group_id === g.id);
        const open = inGroup.filter((i) => i.status === "open");
        const purchased = inGroup
          .filter((i) => i.status === "purchased")
          .sort((a, b) => (b.purchased_at ?? "").localeCompare(a.purchased_at ?? ""));
        return {
          groupId: g.id,
          color: groupColor(g.id),
          title: groupTitle(g.id),
          data: [...open, ...purchased],
        };
      }),
    [cp.groups, cp.items, cp.names]
  );

  const activeGroup =
    targetGroup && cp.groups.some((g) => g.id === targetGroup)
      ? targetGroup
      : cp.groups[0]?.id ?? null;

  const submitDraft = async () => {
    const text = draft.trim();
    if (!text) return;
    if (editing) {
      const res = await cp.editItemText(editing.id, text);
      if (!res.ok) Alert.alert("Couldn't save", friendlyError(res.error));
      setEditing(null);
    } else {
      if (!activeGroup) return;
      const res = await cp.addItem(activeGroup, text, draftBulk);
      if (!res.ok) Alert.alert("Couldn't add item", friendlyError(res.error));
    }
    setDraft("");
    setDraftBulk(false);
  };

  const onRowTap = async (item: Item) => {
    if (item.status === "open") {
      const res = await cp.markPurchased(item.id);
      if (!res.ok) {
        if (res.error === "already_purchased") {
          // The graceful race-loser state (spec §4): informative, not an error.
          Alert.alert(
            "Already bought",
            `${res.purchased_by_name ?? "Someone"} beat you to it.`
          );
        } else {
          Alert.alert("Couldn't mark purchased", friendlyError(res.error));
        }
      }
    } else if (item.purchased_by === userId) {
      const res = await cp.unmarkPurchased(item.id);
      if (!res.ok) Alert.alert("Couldn't unmark", friendlyError(res.error));
    } else {
      Alert.alert(
        "Bought",
        `${cp.nameOf(item.purchased_by)} bought this${when(item.purchased_at)}. Only the buyer can unmark it.`
      );
    }
  };

  // One-tap opt-in / reconfirm on the bulk chip (spec §5). No opt-out exists
  // server-side, so this is entry-only; backing out is a conversation, not a
  // button.
  const onBulkAction = async (item: Item) => {
    const mine = (cp.optIns[item.id] ?? []).find((o) => o.user_id === userId);
    if (mine?.needs_reconfirmation) {
      const res = await cp.bulkReconfirm(item.id);
      if (!res.ok) Alert.alert("Couldn't reconfirm", friendlyError(res.error));
    } else if (!mine) {
      const res = await cp.bulkOptIn(item.id);
      if (!res.ok && res.error !== "already_opted_in") {
        Alert.alert("Couldn't opt in", friendlyError(res.error));
      }
    }
  };

  const assignTargets = (item: Item): { id: string; name: string }[] => {
    const g = cp.groups.find((x) => x.id === item.group_id);
    const already = new Set((cp.optIns[item.id] ?? []).map((o) => o.user_id));
    return (g?.memberIds ?? [])
      .filter((id) => id !== userId && !already.has(id))
      .map((id) => ({ id, name: cp.nameOf(id) }));
  };

  const onRowLongPress = (item: Item) => {
    const actions: { text: string; style?: "destructive" | "cancel"; onPress?: () => void }[] =
      [];
    if (item.added_by === userId) {
      // Only the adder edits/removes (spec §4).
      actions.push({
        text: "Edit text",
        onPress: () => {
          setEditing(item);
          setDraft(item.text);
        },
      });
      actions.push({
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          const res = await cp.removeItem(item.id);
          if (!res.ok) Alert.alert("Couldn't remove", friendlyError(res.error));
        },
      });
    }
    // Retroactive assignment: buyer only, purchased bulk items only (spec §5).
    if (item.is_bulk && item.status === "purchased" && item.purchased_by === userId) {
      const targets = assignTargets(item);
      if (targets.length > 0) {
        actions.push({
          text: "Add someone to this bulk item",
          onPress: () =>
            Alert.alert(
              "Who shared it?",
              "They'll be marked in on this item.",
              [
                ...targets.map((t) => ({
                  text: t.name,
                  onPress: async () => {
                    const res = await cp.bulkAssign(item.id, t.id);
                    if (!res.ok) Alert.alert("Couldn't add them", friendlyError(res.error));
                  },
                })),
                { text: "Cancel", style: "cancel" as const },
              ]
            ),
        });
      }
    }
    if (actions.length === 0) return;
    actions.push({ text: "Cancel", style: "cancel" });
    Alert.alert(item.text, undefined, actions);
  };

  // No navigator in the app yet (spec's depth budget is shallow enough that
  // one swap is cheaper than a dependency), so share is a full-screen swap.
  if (sharing) {
    return (
      <ShareScreen
        // Remount when a new link arrives so a fresh code replaces a stale one
        // even if the share view is already open.
        key={pendingCode ?? "share"}
        groups={cp.groups}
        groupTitle={groupTitle}
        memberCount={(id) => cp.groups.find((g) => g.id === id)?.memberIds.length ?? 0}
        scale={s}
        initialCode={pendingCode ?? undefined}
        onCreateInvite={cp.createInvite}
        onRedeem={cp.redeemInvite}
        onClose={() => {
          setSharing(false);
          setPendingCode(null);
        }}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { fontSize: base.fontSizeTitle * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          Cartpool
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSharing(true)}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Invite someone or join a list"
          >
            <Text
              style={{
                color: colors.accent,
                fontSize: base.fontSizeSmall * s,
                fontWeight: "700",
              }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Share
            </Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Alert.alert("Sign out?", undefined, [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out", style: "destructive", onPress: () => signOut() },
              ])
            }
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text
              style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Sign out
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Queued behind a full group — promotion is automatic and FCFS, so
          this is informational, not an action (spec §3). */}
      {cp.waitlist.length > 0 && (
        <Text style={styles.waitlistBanner} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          {cp.waitlist.length === 1
            ? "You're on the waitlist for a full list. You'll be added as soon as a spot opens."
            : `You're on the waitlist for ${cp.waitlist.length} full lists. You'll be added as spots open.`}
        </Text>
      )}

      {cp.error && (
        <Text style={styles.errorBanner} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          {cp.error}
        </Text>
      )}

      {/* Add bar: open app → tap here → type + confirm = 2 taps (addendum §4.1). */}
      <View style={styles.addBar}>
        <TextInput
          style={[styles.addInput, { fontSize: (base.fontSize + 1) * s, minHeight: base.tapTarget * s }]}
          placeholder={editing ? "Edit item…" : "Add an item…"}
          placeholderTextColor={colors.textSecondary}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submitDraft}
          returnKeyType="done"
          blurOnSubmit={false}
          accessibilityLabel={editing ? "Edit item text" : "Add an item"}
        />
        {!editing && (
          <Pressable
            onPress={() => setDraftBulk((b) => !b)}
            style={[
              styles.bulkChip,
              { minHeight: base.tapTarget * s },
              draftBulk && { backgroundColor: colors.accent, borderColor: colors.accent },
            ]}
            accessibilityRole="button"
            accessibilityLabel={draftBulk ? "Bulk item, tap to make regular" : "Regular item, tap to make bulk"}
          >
            <Text
              style={{
                color: draftBulk ? colors.accentText : colors.textSecondary,
                fontSize: base.fontSizeSmall * s,
                fontWeight: "600",
              }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Bulk
            </Text>
          </Pressable>
        )}
        {editing && (
          <Pressable
            onPress={() => {
              setEditing(null);
              setDraft("");
            }}
            style={[styles.bulkChip, { minHeight: base.tapTarget * s }]}
            accessibilityRole="button"
          >
            <Text
              style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Cancel
            </Text>
          </Pressable>
        )}
      </View>

      {/* Which group new items go to — only shown when there's a choice. */}
      {cp.groups.length > 1 && !editing && (
        <View style={styles.groupPicker}>
          {cp.groups.map((g) => (
            <Pressable
              key={g.id}
              onPress={() => setTargetGroup(g.id)}
              style={[
                styles.groupChip,
                { minHeight: base.tapTarget * s, borderColor: groupColor(g.id) },
                activeGroup === g.id && { backgroundColor: groupColor(g.id) },
              ]}
              accessibilityRole="button"
            >
              <Text
                style={{
                  color: activeGroup === g.id ? colors.accentText : groupColor(g.id),
                  fontSize: base.fontSizeSmall * s,
                  fontWeight: "600",
                }}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                {groupTitle(g.id)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View style={[styles.colorDot, { backgroundColor: section.color }]} />
            <Text
              style={[styles.sectionTitle, { fontSize: base.fontSizeSmall * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item, section }) => (
          <Row
            item={item}
            color={(section as Section).color}
            scale={s}
            nameOf={cp.nameOf}
            optIns={cp.optIns[item.id] ?? []}
            userId={userId}
            onTap={() => onRowTap(item)}
            onLongPress={() => onRowLongPress(item)}
            onBulkAction={() => onBulkAction(item)}
            mine={item.added_by === userId}
          />
        )}
        ListEmptyComponent={
          cp.loading ? null : (
            <View>
              <Text style={styles.empty} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
                Nothing on the list yet. Add your first item above.
              </Text>
              <Pressable
                onPress={() => setSharing(true)}
                style={[styles.emptyAction, { minHeight: base.tapTarget * s }]}
                accessibilityRole="button"
                accessibilityLabel="Share this list with someone, or join someone else's"
              >
                <Text
                  style={{
                    color: colors.accent,
                    fontSize: base.fontSize * s,
                    fontWeight: "600",
                  }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  Share it with someone, or join a list
                </Text>
              </Pressable>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: base.spacing * 4 }}
      />
    </KeyboardAvoidingView>
  );
}

function Row({
  item,
  color,
  scale: s,
  nameOf,
  optIns,
  userId,
  onTap,
  onLongPress,
  onBulkAction,
  mine,
}: {
  item: Item;
  color: string;
  scale: number;
  nameOf: (id: string | null) => string;
  optIns: BulkOptIn[];
  userId: string;
  onTap: () => void;
  onLongPress: () => void;
  onBulkAction: () => void;
  mine: boolean;
}) {
  const purchased = item.status === "purchased";
  const myOptIn = optIns.find((o) => o.user_id === userId);
  // The chip is the one-tap opt-in (spec §5) — or the reconfirm tap when the
  // adder's edit invalidated my pre-commit. Once I'm in and current, it's a
  // passive badge (there is no opt-out).
  const chip = !item.is_bulk
    ? null
    : myOptIn?.needs_reconfirmation
    ? ("reconfirm" as const)
    : myOptIn
    ? ("in" as const)
    : ("join" as const);
  const others = optIns.filter((o) => o.user_id !== userId);
  const shareLine =
    item.is_bulk && optIns.length > 0
      ? ` · In: ${[
          ...(myOptIn ? ["you"] : []),
          ...others.map((o) => nameOf(o.user_id)),
        ].join(", ")}`
      : "";
  return (
    <Pressable
      onPress={onTap}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.row,
        { minHeight: base.rowMinHeight * s },
        pressed && { backgroundColor: colors.surface },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        purchased
          ? `${item.text}, bought by ${nameOf(item.purchased_by)}. ${
              mine ? "Tap to unmark." : ""
            }`
          : `${item.text}, tap to mark purchased`
      }
    >
      <View
        style={[
          styles.checkbox,
          { width: base.tapTarget * 0.6 * s, height: base.tapTarget * 0.6 * s, borderColor: color },
          purchased && { backgroundColor: colors.purchased, borderColor: colors.purchased },
        ]}
      >
        {purchased && (
          <Text style={{ color: colors.accentText, fontSize: base.fontSize * 0.8 * s }}>✓</Text>
        )}
      </View>
      <View style={styles.rowBody}>
        <Text
          style={[
            { fontSize: base.fontSize * s, color: colors.text },
            purchased && { color: colors.purchased, textDecorationLine: "line-through" },
          ]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          {item.text}
          {item.is_bulk ? "  " : ""}
          {item.is_bulk && (
            <Text style={{ color, fontSize: base.fontSizeSmall * s, fontWeight: "700" }}>
              BULK
            </Text>
          )}
        </Text>
        <Text
          style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          {purchased
            ? `Bought by ${nameOf(item.purchased_by)}${when(item.purchased_at)}`
            : `For ${nameOf(item.added_by)}`}
          {item.bulk_note ? ` · ${item.bulk_note}` : ""}
          {shareLine}
        </Text>
      </View>
      {chip && (
        <Pressable
          onPress={onBulkAction}
          disabled={chip === "in"}
          style={[
            styles.optInChip,
            { minHeight: base.tapTarget * s, minWidth: base.tapTarget * s },
            chip === "join" && { borderColor: color },
            chip === "in" && {
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
            chip === "reconfirm" && {
              borderColor: colors.danger,
              backgroundColor: colors.background,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            chip === "join"
              ? `Opt in to share ${item.text}`
              : chip === "reconfirm"
              ? `${item.text} changed after you opted in. Tap to confirm you're still in.`
              : `You're in on ${item.text}`
          }
        >
          <Text
            style={{
              color:
                chip === "join"
                  ? color
                  : chip === "reconfirm"
                  ? colors.danger
                  : colors.textSecondary,
              fontSize: base.fontSizeSmall * s,
              fontWeight: "700",
            }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            {chip === "join" ? "I'm in" : chip === "reconfirm" ? "Still in?" : "In ✓"}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function when(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return ` · ${
    sameDay
      ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }`;
}

function friendlyError(code: string): string {
  switch (code) {
    case "read_only":
      return "Your account is read-only right now (subscription lapsed).";
    case "not_a_member":
      return "You're no longer a member of that group.";
    case "not_adder":
      return "Only the person who added an item can change it.";
    case "not_buyer_or_not_purchased":
      return "Only the buyer can unmark a purchased item.";
    case "not_open":
      return "That item isn't open anymore.";
    case "not_found":
      return "That item no longer exists.";
    case "not_a_bulk_item":
      return "That's not a bulk item anymore.";
    case "not_buyer":
      return "Only the person who bought it can add people to it.";
    case "target_not_a_member":
      return "They're not in this list anymore.";
    case "nothing_to_reconfirm":
      return "Nothing to reconfirm — you're all set.";
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: base.spacing / 2 },
  headerButton: {
    minHeight: base.tapTarget,
    minWidth: base.tapTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  errorBanner: {
    color: colors.danger,
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing / 2,
  },
  waitlistBanner: {
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    fontSize: base.fontSizeSmall,
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing / 2,
  },
  addBar: {
    flexDirection: "row",
    gap: base.spacing / 2,
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing / 2,
  },
  addInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  bulkChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    alignItems: "center",
    justifyContent: "center",
  },
  groupPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: base.spacing / 2,
    paddingHorizontal: base.spacing,
    paddingBottom: base.spacing / 2,
  },
  groupChip: {
    borderWidth: 1.5,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing,
    paddingBottom: 4,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  sectionTitle: {
    color: colors.textSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  rowBody: { flex: 1, gap: 2 },
  optInChip: {
    borderWidth: 1.5,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    color: colors.textSecondary,
    fontSize: base.fontSize,
    textAlign: "center",
    padding: base.spacing * 2,
  },
  emptyAction: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: base.spacing * 2,
  },
});
