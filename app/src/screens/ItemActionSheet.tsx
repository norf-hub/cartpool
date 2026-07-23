// The item action sheet (mockup) — replaces the long-press Alert menu. Opens
// on long-press of a row and gathers everything only the adder or buyer can
// do to an item: edit its text, flip bulk on/off, edit the bulk note, remove
// it, and (for a purchased bulk item) mark a groupmate in on it.
//
// The retroactive-assign picker, which used to be a second nested Alert, is
// flattened into this one sheet: the candidate names render as their own
// buttons under a small heading.
import { StyleSheet, Text, View } from "react-native";
import BottomSheet from "@/components/BottomSheet";
import SheetButton from "@/components/SheetButton";
import type { Item } from "@/hooks/useCartpool";
import { base, colors, fonts } from "@/theme";
import { MAX_OS_FONT_SCALE } from "@/theme/accessibility";

export type ItemActions = {
  onEditText: (item: Item) => void;
  onMakeBulk: (item: Item) => void;
  onMakeRegular: (item: Item) => void;
  onEditNote: (item: Item) => void;
  onRemove: (item: Item) => void;
  onAssign: (item: Item, targetId: string) => void;
};

export default function ItemActionSheet({
  item,
  isMine,
  assignTargets,
  actions,
  scale: s,
  onClose,
}: {
  /** The item whose actions to show, or null when the sheet is closed. */
  item: Item | null;
  isMine: boolean;
  /** Candidates for retroactive bulk assignment (empty unless buyer + bought bulk). */
  assignTargets: { id: string; name: string }[];
  actions: ItemActions;
  scale: number;
  onClose: () => void;
}) {
  const visible = !!item;
  // Each action closes the sheet first, then runs — so the follow-up (an
  // inline note editor, an Alert on error) isn't hidden behind the backdrop.
  const run = (fn: () => void) => {
    onClose();
    fn();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={item?.text} scale={s}>
      {item && (
        <>
          <Text
            style={[styles.title, { fontSize: 26 * s }]}
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
          >
            {item.text}
          </Text>

          {isMine && (
            <SheetButton
              label="Edit text"
              variant="secondary"
              scale={s}
              onPress={() => run(() => actions.onEditText(item))}
            />
          )}

          {isMine && !item.is_bulk && (
            <SheetButton
              label="Make this a bulk item"
              variant="secondary"
              scale={s}
              onPress={() => run(() => actions.onMakeBulk(item))}
            />
          )}

          {isMine && item.is_bulk && (
            <>
              <SheetButton
                label={item.bulk_note ? "Edit bulk note" : "Add a bulk note"}
                variant="secondary"
                scale={s}
                onPress={() => run(() => actions.onEditNote(item))}
              />
              <SheetButton
                label="Make this a regular item"
                variant="secondary"
                scale={s}
                onPress={() => run(() => actions.onMakeRegular(item))}
              />
            </>
          )}

          {assignTargets.length > 0 && (
            <View style={styles.assignBlock}>
              <Text
                style={[styles.assignHeading, { fontSize: base.fontSizeSmall * s }]}
                maxFontSizeMultiplier={MAX_OS_FONT_SCALE}
              >
                Add someone to this bulk item
              </Text>
              {assignTargets.map((t) => (
                <SheetButton
                  key={t.id}
                  label={t.name}
                  variant="secondary"
                  scale={s}
                  onPress={() => run(() => actions.onAssign(item, t.id))}
                />
              ))}
            </View>
          )}

          {isMine && (
            <SheetButton
              label="Remove from list"
              variant="danger"
              scale={s}
              onPress={() => run(() => actions.onRemove(item))}
            />
          )}
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: fonts.heading,
    color: colors.text,
    marginBottom: 6,
    paddingRight: 40, // clear the ✕
  },
  assignBlock: { marginTop: base.spacing, gap: 0 },
  assignHeading: {
    color: colors.textSecondary,
    fontFamily: fonts.bodyBold,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
});
