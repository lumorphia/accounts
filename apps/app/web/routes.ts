import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("settings", "routes/settings.tsx"),
] satisfies RouteConfig;
