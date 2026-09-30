// Single source of truth for tunable, non-visual constants.
// Edit src/config/app.config.json — never hardcode these values in components.
import config from "./app.config.json";

export type AppConfig = typeof config;
export const appConfig: AppConfig = config;
export const { app, api, chunking, chat } = appConfig;
export default appConfig;
