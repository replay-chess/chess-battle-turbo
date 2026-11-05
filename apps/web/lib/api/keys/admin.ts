// Domain `admin` (P12).
import { norm, type Filters } from "./norm";

export const adminKeys = {
  admin: {
    all: () => ["admin"] as const,
    list: (entity: string, f: Filters) => ["admin", entity, norm(f)] as const,
  },
};
