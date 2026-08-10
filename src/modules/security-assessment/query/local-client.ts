/**
 * Client-only local scan adapter. File bytes are read and scanned locally so
 * this path intentionally cannot be replaced with a server-only facade.
 * It exports only the opaque selection and renderer-safe DTOs from query/index.
 */
export { scanSelection, selectSkillFile } from "./index";
