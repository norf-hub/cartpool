// The signed-in shell (mockup layout): four tabs — List, Groups, Grabs,
// You — over one shared Cartpool state. This component owns everything that
// used to make ListScreen the de-facto router: the single useCartpool
// instance, invite deep links, the downgrade gate, and the Share overlay.
// Still no navigator dependency: a tab switch is a swap, and the two
// full-screen states (downgrade, share) simply outrank the tabs.
import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { parseInviteUrl } from "@/lib/links";
import { useAuth } from "@/hooks/useAuth";
import { useCartpool } from "@/hooks/useCartpool";
import { usePush } from "@/hooks/usePush";
import TabBar, { type Tab } from "@/components/TabBar";
import ChooseGroupsScreen from "@/screens/ChooseGroupsScreen";
import GroupsScreen from "@/screens/GroupsScreen";
import ListScreen from "@/screens/ListScreen";
import OffersScreen from "@/screens/OffersScreen";
import ShareScreen from "@/screens/ShareScreen";
import YouScreen from "@/screens/YouScreen";
import NameScreen from "@/screens/NameScreen";
import FirstRunScreen from "@/screens/FirstRunScreen";
import PaywallSheet from "@/screens/PaywallSheet";
import RenameGroupSheet from "@/screens/RenameGroupSheet";
import type { GroupInfo } from "@/hooks/useCartpool";
import { colors } from "@/theme";
import { LARGE_TEXT_SCALE } from "@/theme/accessibility";

// getInitialURL keeps returning the launch URL for the whole app run, so a
// remount (sign out and back in) would re-open the share view with a stale
// code. Module-level because the consumption must outlive the component.
let consumedInitialUrl: string | null = null;

export default function MainTabs({ userId }: { userId: string }) {
  const { signOut } = useAuth();
  const cp = useCartpool(userId);
  const [tab, setTab] = useState<Tab>("list");
  const [sharing, setSharing] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  // Paywall opened from the downgrade screen's "Unlock instead" button.
  const [paywall, setPaywall] = useState(false);
  // Group being named/renamed (0016), or null when the sheet is closed.
  const [renaming, setRenaming] = useState<GroupInfo | null>(null);
  // Id of a just-created group waiting for the name sheet. Held separately
  // because createGroup's refresh is async: the group isn't in cp.groups yet
  // at the moment the RPC returns, and the sheet needs the GroupInfo.
  const [namingNew, setNamingNew] = useState<string | null>(null);
  // Onboarding (name → first-run) for a brand-new account. Latched from the
  // profile's onboarded flag once, then driven locally so the mid-flow
  // set_display_name (which flips onboarded true) doesn't yank the screen.
  const [onboardStep, setOnboardStep] = useState<"name" | "firstrun" | null>(null);
  useEffect(() => {
    if (cp.profile && !cp.profile.onboarded && onboardStep === null) {
      setOnboardStep("name");
    }
  }, [cp.profile, onboardStep]);

  // A new group has no name and no other members, so without this every one
  // of them reads "Just you". Open the name sheet as soon as the group lands
  // in state; if it never arrives (offline refresh), nothing happens and the
  // numbered fallback in groupTitle keeps the labels distinct.
  useEffect(() => {
    if (!namingNew) return;
    const g = cp.groups.find((x) => x.id === namingNew);
    if (g) {
      setRenaming(g);
      setNamingNew(null);
    }
  }, [namingNew, cp.groups]);

  // Large-text mode (addendum §4.1): persisted on the profile row, set via
  // api.set_large_text (0014). cp.setLargeText flips the local profile
  // optimistically, so the scale changes on the spot.
  // Default true, matching the column default (0017): while the profile is
  // still loading, start at the accessible scale rather than flashing small
  // text at someone who needs the large one.
  const largeText = cp.profile?.large_text_mode ?? true;
  const s = largeText ? LARGE_TEXT_SCALE : 1;

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

  // A custom name (0016) always wins; otherwise fall back to who's in it.
  // A group with no one else yet is "Just you" rather than "My list" — it
  // reads as a group waiting for people, which is the point of the app.
  const groupTitle = (groupId: string) => {
    const g = cp.groups.find((x) => x.id === groupId);
    if (!g) return "Group";
    if (g.name) return g.name;
    const others = g.memberIds.filter((id) => id !== userId).map((id) => cp.nameOf(id));
    if (others.length > 0) return `With ${others.join(", ")}`;
    // Every empty group would otherwise be "Just you", which made the Grabs
    // group picker show identical chips. Naming happens at creation now, so
    // this is the fallback for a name sheet that got dismissed. The number is
    // a tiebreaker, not a creation order — cp.groups is sorted by id.
    const solo = cp.groups.filter((x) => !x.name && x.memberIds.length === 1);
    if (solo.length > 1) return `Just you (${solo.findIndex((x) => x.id === groupId) + 1})`;
    return "Just you";
  };

  const openOffers = useMemo(
    () => cp.offers.filter((o) => !o.closed_at && o.qty_remaining > 0).length,
    [cp.offers]
  );

  // Register this device for push, and keep one Android channel per group so a
  // big Costco run collapses into a single stack. Lives here because this is
  // the first thing rendered after sign-in, and because groupTitle gives the
  // channels the same names the user sees. Must sit above the early returns
  // below — onboarding and the downgrade gate must not skip registration.
  usePush(
    userId,
    cp.groups.map((g) => ({ id: g.id, title: groupTitle(g.id) }))
  );

  // Onboarding outranks everything for a new account: name yourself, then the
  // first-run empty-list welcome. Both land in the app when done.
  if (onboardStep === "name") {
    return (
      <NameScreen
        scale={s}
        onSubmit={async (name) => {
          const res = await cp.setDisplayName(name);
          if (res.ok) setOnboardStep("firstrun");
          return res;
        }}
      />
    );
  }
  if (onboardStep === "firstrun") {
    return (
      <FirstRunScreen
        name={(cp.profile?.display_name ?? "there").split(/\s+/)[0]}
        scale={s}
        onAddFirst={() => {
          setTab("list");
          setOnboardStep(null);
        }}
        onInvite={() => {
          setOnboardStep(null);
          setSharing(true);
        }}
        onSkip={() => setOnboardStep(null)}
      />
    );
  }

  // The downgrade gate outranks every other view (spec §9): while frozen,
  // the account is read-only everywhere and this screen is unescapable —
  // it comes back on every refresh until choose_kept_groups succeeds or a
  // resubscription clears the flag server-side.
  // >= 3 not > 3: leaving groups while frozen can shrink the count to
  // exactly 3, and picking all 3 is then the way out of the freeze.
  if (cp.frozen && cp.groups.length >= 3) {
    return (
      <>
        <ChooseGroupsScreen
          groups={cp.groups}
          groupTitle={groupTitle}
          scale={s}
          onConfirm={cp.chooseKeptGroups}
          onResubscribe={() => setPaywall(true)}
        />
        <PaywallSheet
          visible={paywall}
          onClose={() => setPaywall(false)}
          scale={s}
          onBuy={() => {
            // RevenueCat purchase lands with store config (INFRA §5).
            setPaywall(false);
            Alert.alert(
              "Not available yet",
              "Purchasing isn't wired up in this build. Pick 3 groups for now — the others come back when you unlock unlimited groups later."
            );
          }}
        />
      </>
    );
  }

  // Share/join outranks the tabs: it's how deep links arrive, and both the
  // Groups tab and the List empty state open it.
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>
        {tab === "list" && (
          <ListScreen
            cp={cp}
            userId={userId}
            scale={s}
            onOpenShare={() => setSharing(true)}
          />
        )}
        {tab === "groups" && (
          <GroupsScreen
            groups={cp.groups}
            userId={userId}
            groupTitle={groupTitle}
            nameOf={cp.nameOf}
            scale={s}
            onLeave={cp.leaveGroup}
            onBlock={cp.blockUser}
            onShare={() => setSharing(true)}
            onRename={(g) => setRenaming(g)}
            onCreate={async () => {
              const res = await cp.createGroup();
              // Name it straight away, so two empty groups are never
              // indistinguishable in the Grabs group picker.
              if (res.ok) setNamingNew(res.group_id);
              return res;
            }}
            // Hitting the free cap is the paywall's natural entry point — the
            // only other way in is the downgrade screen, which a paying-curious
            // user on the free tier never sees.
            onUpgrade={() => setPaywall(true)}
          />
        )}
        {tab === "grabs" && (
          <OffersScreen
            userId={userId}
            groups={cp.groups}
            offers={cp.offers}
            claims={cp.offerClaims}
            scale={s}
            groupTitle={groupTitle}
            nameOf={cp.nameOf}
            isGroupReadOnly={cp.isGroupReadOnly}
            onCreate={cp.createOffer}
            onClaim={cp.claimOffer}
            onUnclaim={cp.unclaimOffer}
            onCloseOffer={cp.closeOffer}
          />
        )}
        {tab === "you" && (
          <YouScreen
            profile={cp.profile}
            groupCount={cp.groups.length}
            subscription={cp.subscription}
            scale={s}
            largeText={largeText}
            onToggleLargeText={(on) => cp.setLargeText(on)}
            onSignOut={signOut}
          />
        )}
      </View>
      <TabBar tab={tab} onChange={setTab} scale={s} badges={{ grabs: openOffers }} />

      <RenameGroupSheet
        group={renaming}
        fallbackTitle={
          renaming
            ? (() => {
                const others = renaming.memberIds
                  .filter((id) => id !== userId)
                  .map((id) => cp.nameOf(id));
                return others.length === 0 ? "Just you" : `With ${others.join(", ")}`;
              })()
            : ""
        }
        scale={s}
        onRename={cp.renameGroup}
        onClose={() => setRenaming(null)}
      />

      {/* Also mounted here, not just on the downgrade screen: the free-tier cap
          (Groups tab -> Start a new group) is how a never-subscribed user
          reaches the paywall, and they are by definition not frozen. */}
      <PaywallSheet
        visible={paywall}
        onClose={() => setPaywall(false)}
        scale={s}
        onBuy={() => {
          // RevenueCat purchase lands with store config (INFRA §5).
          setPaywall(false);
          Alert.alert(
            "Not available yet",
            "Purchasing isn't wired up in this build yet, so unlimited groups can't be unlocked here."
          );
        }}
      />
    </View>
  );
}
