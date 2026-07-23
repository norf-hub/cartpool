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
import TabBar, { type Tab } from "@/components/TabBar";
import ChooseGroupsScreen from "@/screens/ChooseGroupsScreen";
import GroupsScreen from "@/screens/GroupsScreen";
import ListScreen from "@/screens/ListScreen";
import OffersScreen from "@/screens/OffersScreen";
import ShareScreen from "@/screens/ShareScreen";
import YouScreen from "@/screens/YouScreen";
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

  // Large-text mode: the profile row carries the persisted flag, but there's
  // no server setter yet (large_text_mode has no RPC — follow-up), so the
  // You-tab toggle layers a session override on top of it.
  const [largeTextOverride, setLargeTextOverride] = useState<boolean | null>(null);
  const largeText = largeTextOverride ?? cp.profile?.large_text_mode ?? false;
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

  const groupTitle = (groupId: string) => {
    const g = cp.groups.find((x) => x.id === groupId);
    if (!g) return "List";
    const others = g.memberIds.filter((id) => id !== userId).map((id) => cp.nameOf(id));
    return others.length === 0 ? "My list" : `With ${others.join(", ")}`;
  };

  const openOffers = useMemo(
    () => cp.offers.filter((o) => !o.closed_at && o.qty_remaining > 0).length,
    [cp.offers]
  );

  // The downgrade gate outranks every other view (spec §9): while frozen,
  // the account is read-only everywhere and this screen is unescapable —
  // it comes back on every refresh until choose_kept_groups succeeds or a
  // resubscription clears the flag server-side.
  // >= 3 not > 3: leaving groups while frozen can shrink the count to
  // exactly 3, and picking all 3 is then the way out of the freeze.
  if (cp.frozen && cp.groups.length >= 3) {
    return (
      <ChooseGroupsScreen
        groups={cp.groups}
        groupTitle={groupTitle}
        scale={s}
        onConfirm={cp.chooseKeptGroups}
        onResubscribe={() =>
          // Paywall lands with RevenueCat config (INFRA §5); react-native-
          // purchases is already a dependency, so this is wiring, not surgery.
          Alert.alert(
            "Not available yet",
            "Purchasing isn't wired up in this build. Pick 3 lists for now — the others come back in full when you unlock unlimited lists later."
          )
        }
      />
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
            onToggleLargeText={(on) => setLargeTextOverride(on)}
            onSignOut={signOut}
          />
        )}
      </View>
      <TabBar tab={tab} onChange={setTab} scale={s} badges={{ grabs: openOffers }} />
    </View>
  );
}
