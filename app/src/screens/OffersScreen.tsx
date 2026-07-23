// "Up for grabs" (spec v3.2): post surplus units from an over-sized pack;
// groupmates claim units of it. One person can take more than one — "Take
// one" simply accumulates (Bill taps it twice for 2 of Joe's 3 clippers),
// which keeps the tap targets big and the flow keyboard-free. The server
// serializes racing claims; a losing tap gets the live remaining count.
//
// Price is a LABEL only (Free / At cost / Name a price) — money changes
// hands offline and the app never tracks who paid (spec: history, not
// ledger).
import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { GroupInfo, Offer, OfferClaim } from "@/hooks/useCartpool";
import type { RpcResult } from "@/api/rpc";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

type Pricing = "free" | "at_cost" | "custom";

type Props = {
  userId: string;
  groups: GroupInfo[];
  offers: Offer[];
  claims: Record<string, OfferClaim[]>;
  scale: number;
  groupTitle: (groupId: string) => string;
  nameOf: (id: string | null) => string;
  isGroupReadOnly: (groupId: string) => boolean;
  onCreate: (
    groupId: string,
    text: string,
    qty: number,
    priceCents: number | null
  ) => Promise<RpcResult<{ offer_id: string }>>;
  onClaim: (offerId: string, qty: number) => Promise<RpcResult<{ qty_remaining: number }>>;
  onUnclaim: (offerId: string, qty?: number) => Promise<RpcResult>;
  onCloseOffer: (offerId: string) => Promise<RpcResult>;
  onClose: () => void;
};

const money = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export default function OffersScreen(p: Props) {
  const s = p.scale;
  const [text, setText] = useState("");
  const [qty, setQty] = useState(1);
  const [pricing, setPricing] = useState<Pricing>("free");
  // At cost: what the whole pack cost + how many units it had -> per-unit.
  const [packPaid, setPackPaid] = useState("");
  const [packSize, setPackSize] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [targetGroup, setTargetGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const writable = p.groups.filter((g) => !p.isGroupReadOnly(g.id));
  const activeGroup =
    targetGroup && writable.some((g) => g.id === targetGroup)
      ? targetGroup
      : writable[0]?.id ?? null;

  const atCostCents = useMemo(() => {
    const paid = parseFloat(packPaid);
    const size = parseInt(packSize, 10);
    if (!isFinite(paid) || !isFinite(size) || size < 1) return null;
    return Math.round((paid * 100) / size);
  }, [packPaid, packSize]);

  const priceCents: number | null =
    pricing === "free"
      ? null
      : pricing === "at_cost"
        ? atCostCents
        : isFinite(parseFloat(customPrice))
          ? Math.round(parseFloat(customPrice) * 100)
          : null;

  const canPost =
    !!activeGroup && text.trim().length > 0 && qty >= 1 && (pricing === "free" || priceCents !== null);

  const post = async () => {
    if (!canPost || busy) return;
    setBusy(true);
    try {
      const r = await p.onCreate(activeGroup!, text.trim(), qty, priceCents);
      if (!r.ok) {
        Alert.alert("Couldn't post", friendly(r.error));
        return;
      }
      setText("");
      setQty(1);
      setPricing("free");
      setPackPaid("");
      setPackSize("");
      setCustomPrice("");
    } finally {
      setBusy(false);
    }
  };

  const takeOne = async (offer: Offer) => {
    const r = await p.onClaim(offer.id, 1);
    if (!r.ok) {
      if (r.error === "not_enough_left") {
        const left = (r as { qty_remaining?: number }).qty_remaining ?? 0;
        Alert.alert(
          left === 0 ? "All spoken for" : "Not enough left",
          left === 0
            ? "Someone beat you to the last one."
            : `Only ${left} left now.`
        );
      } else {
        Alert.alert("Couldn't claim", friendly(r.error));
      }
    }
  };

  const myClaim = (offer: Offer) =>
    (p.claims[offer.id] ?? []).find((c) => c.user_id === p.userId);

  const sectionsWithOffers = p.groups
    .map((g) => ({ group: g, offers: p.offers.filter((o) => o.group_id === g.id) }))
    .filter((x) => x.offers.length > 0);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text
          style={[styles.headerTitle, { fontSize: base.fontSizeTitle * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
        >
          Up for grabs
        </Text>
        <Pressable
          onPress={p.onClose}
          style={[styles.headerButton, { minHeight: base.tapTarget * s }]}
          accessibilityRole="button"
          accessibilityLabel="Back to the list"
        >
          <Text
            style={{ color: colors.accent, fontSize: base.fontSize * s, fontWeight: "700" }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Done
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: base.spacing * 4 }}>
        {/* ---- Post form -------------------------------------------------- */}
        <Text style={[styles.formHint, { fontSize: base.fontSizeSmall * s }]}
          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
          Bought more than you need? Post the extras and let your group take
          them off your hands.
        </Text>

        <View style={styles.formRow}>
          <TextInput
            style={[styles.input, { fontSize: (base.fontSize + 1) * s, minHeight: base.tapTarget * s }]}
            placeholder="What's up for grabs? e.g. nail clippers"
            placeholderTextColor={colors.textSecondary}
            value={text}
            onChangeText={setText}
            accessibilityLabel="What is up for grabs"
          />
        </View>

        {/* Quantity stepper: big targets, no keyboard. */}
        <View style={styles.formRow}>
          <Text style={[styles.label, { fontSize: base.fontSize * s }]}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            How many extras?
          </Text>
          <View style={styles.stepper}>
            <Pressable
              onPress={() => setQty((q) => Math.max(1, q - 1))}
              style={[styles.stepBtn, { minWidth: base.tapTarget * s, minHeight: base.tapTarget * s }]}
              accessibilityRole="button"
              accessibilityLabel="One fewer"
            >
              <Text style={[styles.stepText, { fontSize: (base.fontSize + 4) * s }]}>−</Text>
            </Pressable>
            <Text
              style={[styles.qty, { fontSize: (base.fontSize + 4) * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              accessibilityLabel={`${qty} extras`}
            >
              {qty}
            </Text>
            <Pressable
              onPress={() => setQty((q) => q + 1)}
              style={[styles.stepBtn, { minWidth: base.tapTarget * s, minHeight: base.tapTarget * s }]}
              accessibilityRole="button"
              accessibilityLabel="One more"
            >
              <Text style={[styles.stepText, { fontSize: (base.fontSize + 4) * s }]}>+</Text>
            </Pressable>
          </View>
        </View>

        {/* Price chips: Free / At cost / Name a price. The poster chooses;
            the app never tracks payment either way. */}
        <View style={styles.chipRow}>
          {(
            [
              ["free", "Free"],
              ["at_cost", "At cost"],
              ["custom", "Name a price"],
            ] as [Pricing, string][]
          ).map(([kind, label]) => (
            <Pressable
              key={kind}
              onPress={() => setPricing(kind)}
              style={[
                styles.chip,
                { minHeight: base.tapTarget * s },
                pricing === kind && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Price: ${label}`}
            >
              <Text
                style={{
                  color: pricing === kind ? colors.accentText : colors.textSecondary,
                  fontSize: base.fontSizeSmall * s,
                  fontWeight: "600",
                }}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {pricing === "at_cost" && (
          <View style={styles.formRow}>
            <TextInput
              style={[styles.inputSmall, { fontSize: base.fontSize * s, minHeight: base.tapTarget * s }]}
              placeholder="Pack cost, e.g. 12"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
              value={packPaid}
              onChangeText={setPackPaid}
              accessibilityLabel="What the whole pack cost"
            />
            <TextInput
              style={[styles.inputSmall, { fontSize: base.fontSize * s, minHeight: base.tapTarget * s }]}
              placeholder="Pack size, e.g. 4"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
              value={packSize}
              onChangeText={setPackSize}
              accessibilityLabel="How many were in the pack"
            />
            <Text
              style={{ color: colors.textSecondary, fontSize: base.fontSizeSmall * s, alignSelf: "center" }}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              {atCostCents !== null ? `= ${money(atCostCents)} each` : ""}
            </Text>
          </View>
        )}

        {pricing === "custom" && (
          <View style={styles.formRow}>
            <TextInput
              style={[styles.inputSmall, { fontSize: base.fontSize * s, minHeight: base.tapTarget * s }]}
              placeholder="Price each, e.g. 3"
              placeholderTextColor={colors.textSecondary}
              keyboardType="decimal-pad"
              value={customPrice}
              onChangeText={setCustomPrice}
              accessibilityLabel="Price for each one"
            />
          </View>
        )}

        {/* Which group sees it — only when there's a choice. */}
        {writable.length > 1 && (
          <View style={styles.chipRow}>
            {writable.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => setTargetGroup(g.id)}
                style={[
                  styles.chip,
                  { minHeight: base.tapTarget * s },
                  activeGroup === g.id && { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                accessibilityRole="button"
              >
                <Text
                  style={{
                    color: activeGroup === g.id ? colors.accentText : colors.textSecondary,
                    fontSize: base.fontSizeSmall * s,
                    fontWeight: "600",
                  }}
                  maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                >
                  {p.groupTitle(g.id)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable
          onPress={post}
          disabled={!canPost || busy}
          style={[
            styles.postBtn,
            { minHeight: base.tapTarget * s },
            (!canPost || busy) && { opacity: 0.4 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Post these extras to your group"
        >
          <Text
            style={{ color: colors.accentText, fontSize: base.fontSize * s, fontWeight: "700" }}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            Post it
          </Text>
        </Pressable>

        {/* ---- Open offers, grouped by list ------------------------------- */}
        {sectionsWithOffers.length === 0 && (
          <Text style={styles.empty} maxFontSizeMultiplier={MAX_OS_FONT_SCALE}>
            Nothing up for grabs right now.
          </Text>
        )}

        {sectionsWithOffers.map(({ group, offers }) => (
          <View key={group.id}>
            <Text
              style={[styles.sectionTitle, { fontSize: base.fontSizeSmall * s }]}
              maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
            >
              {p.groupTitle(group.id)}
            </Text>
            {offers.map((o) => {
              const mine = o.posted_by === p.userId;
              const claim = myClaim(o);
              const roster = (p.claims[o.id] ?? [])
                .map((c) => `${p.nameOf(c.user_id)} ×${c.qty}`)
                .join(", ");
              return (
                <View key={o.id} style={styles.offerCard}>
                  <Text
                    style={[styles.offerText, { fontSize: (base.fontSize + 1) * s }]}
                    maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                  >
                    {o.text}
                  </Text>
                  <Text
                    style={[styles.offerMeta, { fontSize: base.fontSizeSmall * s }]}
                    maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                  >
                    {o.qty_remaining} of {o.qty_offered} left
                    {" · "}
                    {o.unit_price_cents === null ? "free" : `${money(o.unit_price_cents)} each`}
                    {" · "}from {p.nameOf(o.posted_by)}
                  </Text>
                  {roster.length > 0 && (
                    <Text
                      style={[styles.offerMeta, { fontSize: base.fontSizeSmall * s }]}
                      maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                    >
                      Taking: {roster}
                    </Text>
                  )}
                  <View style={styles.offerActions}>
                    {!mine && o.qty_remaining > 0 && !p.isGroupReadOnly(o.group_id) && (
                      <Pressable
                        onPress={() => takeOne(o)}
                        style={[styles.actionBtn, { minHeight: base.tapTarget * s }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Take one ${o.text}. Tap again for another.`}
                      >
                        <Text
                          style={{ color: colors.accentText, fontSize: base.fontSize * s, fontWeight: "600" }}
                          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                        >
                          {claim ? "Take another" : "Take one"}
                        </Text>
                      </Pressable>
                    )}
                    {!mine && claim && (
                      <Pressable
                        onPress={async () => {
                          const r = await p.onUnclaim(o.id, 1);
                          if (!r.ok) Alert.alert("Couldn't give back", friendly(r.error));
                        }}
                        style={[styles.actionBtnGhost, { minHeight: base.tapTarget * s }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Give one back. You have ${claim.qty}.`}
                      >
                        <Text
                          style={{ color: colors.accent, fontSize: base.fontSize * s, fontWeight: "600" }}
                          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                        >
                          Give one back (you: {claim.qty})
                        </Text>
                      </Pressable>
                    )}
                    {mine && (
                      <Pressable
                        onPress={() =>
                          Alert.alert("Take this down?", "Anything already claimed stands.", [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Take it down",
                              style: "destructive",
                              onPress: async () => {
                                const r = await p.onCloseOffer(o.id);
                                if (!r.ok) Alert.alert("Couldn't remove", friendly(r.error));
                              },
                            },
                          ])
                        }
                        style={[styles.actionBtnGhost, { minHeight: base.tapTarget * s }]}
                        accessibilityRole="button"
                        accessibilityLabel="Take this offer down"
                      >
                        <Text
                          style={{ color: colors.textSecondary, fontSize: base.fontSize * s }}
                          maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
                        >
                          Take it down
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function friendly(code: string): string {
  switch (code) {
    case "read_only":
      return "This list is read-only right now.";
    case "not_a_member":
      return "You're not in this list anymore.";
    case "own_offer":
      return "These are your own extras.";
    case "closed":
      return "This offer was taken down.";
    case "expired":
      return "This offer has expired.";
    case "no_claim":
      return "You haven't taken any of these.";
    case "bad_qty":
      return "That number doesn't work here.";
    case "empty_text":
      return "Say what the item is first.";
    default:
      return "Something went wrong. Please try again.";
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing * 3,
    paddingBottom: base.spacing,
  },
  headerTitle: { fontFamily: fonts.heading, color: colors.accent },
  headerButton: { justifyContent: "center", paddingHorizontal: base.spacing },
  formHint: {
    color: colors.textSecondary,
    paddingHorizontal: base.spacing,
    paddingBottom: base.spacing / 2,
  },
  formRow: {
    flexDirection: "row",
    gap: base.spacing / 2,
    alignItems: "center",
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing / 4,
  },
  label: { color: colors.text, flex: 1 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputSmall: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  stepper: { flexDirection: "row", alignItems: "center", gap: base.spacing / 2 },
  stepBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    backgroundColor: colors.surface,
  },
  stepText: { color: colors.accent, fontWeight: "700" },
  qty: { color: colors.text, fontWeight: "700", minWidth: 32, textAlign: "center" },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: base.spacing / 2,
    paddingHorizontal: base.spacing,
    paddingVertical: base.spacing / 4,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  postBtn: {
    backgroundColor: colors.accent,
    borderRadius: base.radius,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: base.spacing,
    marginTop: base.spacing / 2,
  },
  empty: {
    color: colors.textSecondary,
    textAlign: "center",
    paddingTop: base.spacing * 2,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: base.spacing,
    paddingTop: base.spacing * 1.5,
    paddingBottom: base.spacing / 2,
  },
  offerCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    marginHorizontal: base.spacing,
    marginBottom: base.spacing / 2,
    padding: base.spacing,
    gap: 4,
  },
  offerText: { color: colors.text, fontWeight: "600" },
  offerMeta: { color: colors.textSecondary },
  offerActions: { flexDirection: "row", flexWrap: "wrap", gap: base.spacing / 2, marginTop: 4 },
  actionBtn: {
    backgroundColor: colors.accent,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    justifyContent: "center",
  },
  actionBtnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: base.radius,
    paddingHorizontal: base.spacing,
    justifyContent: "center",
  },
});
