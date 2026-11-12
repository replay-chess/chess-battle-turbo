// ESLint for the analysis worker: the shared base config (incl. `replay/no-room-literal`), as for the socket server.
import { config } from "@repo/eslint-config/base";

export default [...config, { ignores: ["dist/**", "node_modules/**"] }];
