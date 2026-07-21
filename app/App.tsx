import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/useAuth";
import SignInScreen from "@/screens/SignInScreen";
import ListScreen from "@/screens/ListScreen";
import { colors } from "@/theme";

export default function App() {
  const { userId, loading } = useAuth();

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" />
      {loading ? (
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
