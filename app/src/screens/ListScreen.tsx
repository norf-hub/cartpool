// The merged list (spec §2, cross-group model 0013): one unified list. An
// item you add is visible in every group you're in; the first buyer anywhere
// clears it everywhere. Sections: "To pick up" (your items someone bought
// for you, buyer shown), open items, then purchase history. Core-loop
// actions only — add, mark purchased (1 tap, no dialog), unmark (buyer
// only), edit/remove (adder only).
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { type BulkOptIn, type Cartpool, type Item } from "@/hooks/useCartpool";
import ListHero from "@/screens/ListHero";
import { base, colors, fonts, groupPalette } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

type Section = { key: string; color: string; title: string; data: Item[] };

export default function ListScreen({
  cp,
  userId,
  scale: s,
  onOpenShare,
}: {
  /** Shared client state — the tab shell owns the single instance. */
  cp: Cartpool;
  userId: string;
  scale: number;
  /** Opens the share/join overlay (owned by the shell). */
  onOpenShare: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [draftBulk, setDraftBulk] = useState(false);
  const [draftNote, setDraftNote] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  // Note editing reuses the inline note input rather than a dialog:
  // Alert.prompt is iOS-only, and a second modal path would drift from the
  // add-bar behaviour.
  const [noteEditing, setNoteEditing] = useState<Item | null>(null);

  // First name for the hero greeting; falls back gracefully pre-profile-load.
  const heroName = (cp.profile?.display_name ?? "there").split(/\s+/)[0];

  // Everyone whose items can appear on my list (me + every groupmate),
  // stable order: me first, then by name. Drives the per-person row colors
  // that replaced the per-group ones.
  const pool: string[] = useMemo(() => {
    const others = [...new Set(cp.groups.flatMap((g) => g.memberIds))]
      .filter((id) => id !== userId)
      .sort((a, b) => cp.nameOf(a).localeCompare(cp.nameOf(b)));
    return [userId, ...others];
  }, [cp.groups, cp.names, userId]);

  const personColor = (id: string | null) => {
    const i = id ? pool.indexOf(id) : -1;
    return groupPalette[(i < 0 ? 0 : i) % groupPalette.length];
  };

  // Cross-group model: one unified list (mockup layout).
  //   • The most recent pickup — my item someone else bought for me — becomes
  //     the "Waiting for you" hero at the top (see ListHero).
  //   • Still open — every open item I can see.
  //   • Recently bought — the rest of the purchase history.
  // Any extra pickups beyond the featured one (rare) get their own section so
  // nothing is hidden.
  const byNewest = (a: Item, b: Item) =>
    (b.purchased_at ?? "").localeCompare(a.purchased_at ?? "");

  const pickups = useMemo(
    () =>
      cp.items
        .filter(
          (i) => i.status === "purchased" && i.added_by === userId && i.purchased_by !== userId
        )
        .sort(byNewest),
    [cp.items, userId]
  );
  const heroPickup = pickups[0] ?? null;

  const sections: Section[] = useMemo(() => {
    const open = cp.items.filter((i) => i.status === "open");
    const history = cp.items
      .filter(
        (i) =>
          i.status === "purchased" && !(i.added_by === userId && i.purchased_by !== userId)
      )
      .sort(byNewest);
    const out: Section[] = [];
    const extraPickups = pickups.slice(1);
    if (extraPickups.length > 0)
      out.push({ key: "pickup", color: colors.accent, title: "Also waiting for you", data: extraPickups });
    out.push({ key: "open", color: colors.accent, title: "Still open", data: open });
    if (history.length > 0)
      out.push({ key: "done", color: colors.purchased, title: "Recently bought", data: history });
    return out;
  }, [cp.items, userId, pickups]);

  // Cross-group model: an item's home group no longer decides who sees it,
  // so there's nothing for the user to pick — new items go to the first
  // writable group and appear everywhere anyway.
  const writableGroups = cp.groups.filter((g) => !cp.isGroupReadOnly(g.id));
  const activeGroup = writableGroups[0]?.id ?? null;

  const submitDraft = async () => {
    const text = draft.trim();
    if (!text) return;
    if (editing) {
      const res = await cp.editItemText(editing.id, text);
      if (!res.ok) Alert.alert("Couldn't save", friendlyError(res.error));
      setEditing(null);
    } else {
      if (!activeGroup) {
        // No writable group. Legitimate only mid-provisioning or when frozen;
        // otherwise something is wrong (e.g. the account's data is gone) and
        // silence would leave the user tapping at a dead button.
        Alert.alert(
          "No list to add to",
          "Your account doesn't seem to have a list right now. Try signing out and back in; if that doesn't fix it, the server data may have been reset."
        );
        return;
      }
      const note = draftBulk ? draftNote.trim() || undefined : undefined;
      const res = await cp.addItem(activeGroup, text, draftBulk, note);
      if (!res.ok) Alert.alert("Couldn't add item", friendlyError(res.error));
    }
    setDraft("");
    setDraftBulk(false);
    setDraftNote("");
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

  const promptNote = (item: Item) => {
    setNoteEditing(item);
    setDraftNote(item.bulk_note ?? "");
  };

  const saveNote = async () => {
    if (!noteEditing) return;
    const res = await cp.setItemBulk(noteEditing.id, true, draftNote.trim() || undefined);
    if (!res.ok) Alert.alert("Couldn't save the note", friendlyError(res.error));
    setNoteEditing(null);
    setDraftNote("");
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

  // Cross-group model: anyone who shares a group with me is a candidate, not
  // just the item's home group (the server checks against the adder's pool).
  const assignTargets = (item: Item): { id: string; name: string }[] => {
    const already = new Set((cp.optIns[item.id] ?? []).map((o) => o.user_id));
    return pool
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
      // Bulk is settable after the fact (0010), not just at add time.
      if (!item.is_bulk) {
        actions.push({
          text: "Make this a bulk item",
          onPress: async () => {
            const res = await cp.setItemBulk(item.id, true);
            if (!res.ok) Alert.alert("Couldn't change it", friendlyError(res.error));
          },
        });
      } else {
        actions.push({
          text: item.bulk_note ? "Edit bulk note" : "Add a bulk note",
          onPress: () => promptNote(item),
        });
        actions.push({
          text: "Make this a regular item",
          onPress: async () => {
            const res = await cp.setItemBulk(item.id, false);
            if (!res.ok) Alert.alert("Couldn't change it", friendlyError(res.error));
          },
        });
      }
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

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* The title/greeting now lives in the scrollable hero (ListHero) below;
          the old header action row moved into the tab bar and the You tab. */}

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

      {/* Bulk note (spec §5): no structured quantity field by design, so this
          free text carries "the unsalted kind". Only while Bulk is on. */}
      {(noteEditing || (draftBulk && !editing)) && (
        <View style={styles.noteRow}>
          {noteEditing && (
            <Text
              style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              Note for “{noteEditing.text}”
            </Text>
          )}
          <View style={styles.noteInputRow}>
            <TextInput
              style={[
                styles.noteInput,
                { fontSize: base.fontSize * s, minHeight: base.tapTarget * s },
              ]}
              placeholder="Note (optional) — e.g. the unsalted kind"
              placeholderTextColor={colors.textSecondary}
              value={draftNote}
              onChangeText={setDraftNote}
              onSubmitEditing={noteEditing ? saveNote : submitDraft}
              returnKeyType="done"
              autoFocus={!!noteEditing}
              accessibilityLabel="Bulk item note, optional"
            />
            {noteEditing && (
              <>
                <Pressable
                  onPress={saveNote}
                  style={[styles.bulkChip, { minHeight: base.tapTarget * s }]}
                  accessibilityRole="button"
                  accessibilityLabel="Save note"
                >
                  <Text
                    style={{
                      color: colors.accent,
                      fontSize: base.fontSizeSmall * s,
                      fontWeight: "700",
                    }}
                    maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                  >
                    Save
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setNoteEditing(null);
                    setDraftNote("");
                  }}
                  style={[styles.bulkChip, { minHeight: base.tapTarget * s }]}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text
                    style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s }}
                    maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                  >
                    Cancel
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <ListHero
            youName={heroName}
            groupCount={cp.groups.length}
            pickup={heroPickup}
            buyerName={heroPickup ? cp.nameOf(heroPickup.purchased_by) : ""}
            whenText={heroPickup ? when(heroPickup.purchased_at) : ""}
            scale={s}
            onPress={() => heroPickup && onRowTap(heroPickup)}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={[styles.sectionHeader, { minHeight: base.tapTarget * s }]}>
            <View style={[styles.colorDot, { backgroundColor: section.color }]} />
            <Text
              style={[styles.sectionTitle, { fontSize: base.fontSizeSmall * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              {section.title}
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Row
            item={item}
            color={personColor(item.added_by)}
            scale={s}
            nameOf={cp.nameOf}
            optIns={cp.optIns[item.id] ?? []}
            userId={userId}
            onTap={() => onRowTap(item)}
            onLongPress={() => onRowLongPress(item)}
            onBulkAction={() => onBulkAction(item)}
            mine={item.added_by === userId}
            pickup={
              item.status === "purchased" &&
              item.added_by === userId &&
              item.purchased_by !== userId
            }
          />
        )}
        ListEmptyComponent={
          cp.loading ? null : (
            <View>
              <Text style={styles.empty} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
                Nothing on the list yet. Add your first item above.
              </Text>
              <Pressable
                onPress={onOpenShare}
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
  pickup,
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
  /** My item, bought by someone else: show who to pick it up from. */
  pickup: boolean;
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
        pickup
          ? `${item.text}, pick up from ${nameOf(item.purchased_by)}.`
          : purchased
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
          {pickup
            ? `Pick up from ${nameOf(item.purchased_by)}${when(item.purchased_at)}`
            : purchased
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
    case "has_opt_ins":
      return "People have already opted in, so this has to stay a bulk item.";
    default:
      return `Something went wrong (${code}).`;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
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
  noteRow: {
    paddingHorizontal: base.spacing,
    paddingBottom: base.spacing / 2,
    gap: 4,
  },
  noteInputRow: { flexDirection: "row", gap: base.spacing / 2 },
  noteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    color: colors.text,
    backgroundColor: colors.surface,
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
