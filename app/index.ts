// Custom entry point, needed because this app lives inside an npm workspace
// (see package.json "workspaces" at the repo root). Hoisting moves `expo`
// into the root node_modules, which breaks the relative "../../App" import
// baked into the default node_modules/expo/AppEntry.js entry point. This
// file replaces that default (see "main" in package.json).
import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and works the same whether the app is loaded in Expo Go or a native build.
registerRootComponent(App);
