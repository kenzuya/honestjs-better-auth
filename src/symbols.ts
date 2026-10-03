export const BEFORE_HOOK_KEY = Symbol("BEFORE_HOOK") as symbol;
export const AFTER_HOOK_KEY = Symbol("AFTER_HOOK") as symbol;
export const HOOK_KEY = Symbol("HOOK") as symbol;

export const DATABASE_HOOK_KEY = Symbol("DATABASE_HOOK") as symbol;
export const BEFORE_DATABASE_HOOK_KEY = Symbol(
	"BEFORE_DATABASE_HOOK",
) as symbol;
export const AFTER_DATABASE_HOOK_KEY = Symbol("AFTER_DATABASE_HOOK") as symbol;

export const PUBLIC_KEY = Symbol("PUBLIC") as symbol;
export const OPTIONAL_KEY = Symbol("OPTIONAL") as symbol;
export const REQUIRE_ACTIVE_ORG_KEY = Symbol("REQUIRE_ACTIVE_ORG") as symbol;
export const ROLES_KEY = Symbol("ROLES") as symbol;
export const ORG_ROLES_KEY = Symbol("ORG_ROLES") as symbol;
export const USER_HAS_PERMISSION_KEY = Symbol("USER_HAS_PERMISSION") as symbol;
export const MEMBER_HAS_PERMISSION_KEY = Symbol(
	"MEMBER_HAS_PERMISSION",
) as symbol;

/**
 * Hono context variable holding the session resolved by the AuthGuard.
 * Read it with `@Session()`, `@Var("session")` or `c.get("session")`.
 */
export const SESSION_CONTEXT_KEY = "session";

/**
 * Hono context variable holding the user resolved by the AuthGuard.
 * Read it with `@Var("user")` or `c.get("user")`.
 */
export const USER_CONTEXT_KEY = "user";
