// ESLint for the socket server: the shared base config (incl. `replay/no-room-literal`; src/v1/** is exempt).
import { config } from "@repo/eslint-config/base";

export default [...config, { ignores: ["dist/**", "node_modules/**"] }];
