import { ActivityIndicator, StatusBar, Text, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts, Caprasimo_400Regular } from "@expo-google-fonts/caprasimo";
import {
  Figtree_400Regular,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from "@expo-google-fonts/figtree";
import { useAuth } from "@/hooks/useAuth";
import SignInScreen from "@/screens/SignInScreen";
import ListScreen from "@/screens/ListScreen";
import { colors, fonts } from "@/theme";

// Organic body font applied app-wide as the default, so screens don't each
// need to name it. Set once at module load — fontFamily is just a name, so it
// doesn't depend on the async load below; useFonts only gates rendering until
// the file is actually available. Titles override this with the heading font.
// (RN doesn't synthesize weight from a custom font, so bold labels stay
// Figtree Regular unless a style names the SemiBold/Bold family explicitly.)
const TextAny = Text as unknown as { defaultProps?: { style?: unknown } };
const InputAny = TextInput as unknown as { defaultProps?: { style?: unknown } };
TextAny.defaultProps = TextAny.defaultProps || {};
TextAny.defaultProps.style = [{ fontFamily: fonts.body }, TextAny.defaultProps.style];
InputAny.defaultProps = InputAny.defaultProps || {};
InputAny.defaultProps.style = [{ fontFamily: fonts.body }, InputAny.defaultProps.style];

export default function App() {
  const { userId, loading } = useAuth();
  const [fontsLoaded] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });

  const booting = loading || !fontsLoaded;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar barStyle="dark-content" />
        {booting ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : userId ? (
          <ListScreen userId={userId} />
        ) : (
          <SignInScreen />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
