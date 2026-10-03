import { createParamDecorator } from "@kenzuya/honest";
import type { createAuthMiddleware } from "better-auth/api";
import {
	type ClassOrMethodDecorator,
	SetMetadata,
	applyDecorators,
	registerHookProvider,
} from "./metadata.ts";
import {
	AFTER_DATABASE_HOOK_KEY,
	AFTER_HOOK_KEY,
	BEFORE_DATABASE_HOOK_KEY,
	BEFORE_HOOK_KEY,
	DATABASE_HOOK_KEY,
	HOOK_KEY,
	MEMBER_HAS_PERMISSION_KEY,
	OPTIONAL_KEY,
	ORG_ROLES_KEY,
	PUBLIC_KEY,
	REQUIRE_ACTIVE_ORG_KEY,
	ROLES_KEY,
	SESSION_CONTEXT_KEY,
	USER_HAS_PERMISSION_KEY,
} from "./symbols.ts";

/**
 * Allows unauthenticated (anonymous) access to a route or controller.
 * When applied, the AuthGuard still resolves the session but never rejects the request.
 */
export const AllowAnonymous = (): ClassOrMethodDecorator =>
	SetMetadata(PUBLIC_KEY, true);

/**
 * Marks a route or controller as having optional authentication.
 * When applied, the AuthGuard allows the request to proceed
 * even if no session is present.
 */
export const OptionalAuth = (): ClassOrMethodDecorator =>
	SetMetadata(OPTIONAL_KEY, true);

/**
 * Requires an authenticated session with an active organization selected.
 * Does not check for any specific organization role.
 */
export const RequireActiveOrg = (): ClassOrMethodDecorator =>
	SetMetadata(REQUIRE_ACTIVE_ORG_KEY, true);

/**
 * Specifies the user-level roles required to access a route or controller.
 * Checks ONLY the `user.role` field (from Better Auth's admin plugin).
 * Does NOT check organization member roles.
 *
 * Use this for system-wide admin protection (e.g., superadmin routes).
 *
 * @param roles - The roles required for access
 * @example
 * ```ts
 * @Roles(['admin'])  // Only users with user.role = 'admin' can access
 * ```
 */
export const Roles = (roles: string[]): ClassOrMethodDecorator =>
	SetMetadata(ROLES_KEY, roles);

/**
 * Specifies the organization-level roles required to access a route or controller.
 * Checks ONLY the organization member role (from Better Auth's organization plugin).
 * Requires an active organization (`activeOrganizationId` in session).
 *
 * Use this for organization-scoped protection (e.g., org admin routes).
 *
 * @param roles - The organization roles required for access
 * @example
 * ```ts
 * @OrgRoles(['owner', 'admin'])  // Only org owners/admins can access
 * ```
 */
export const OrgRoles = (roles: string[]): ClassOrMethodDecorator =>
	applyDecorators(RequireActiveOrg(), SetMetadata(ORG_ROLES_KEY, roles));

/**
 * Type for permission checks - maps resource names to arrays of actions
 */
export type PermissionCheck = Record<string, string[]>;

/**
 * Options for the UserHasPermission decorator
 */
export interface UserHasPermissionOptions {
	/**
	 * The user ID to check permissions for (optional, defaults to current user)
	 */
	userId?: string;
	/**
	 * The role to check permissions for (server-only, optional)
	 */
	role?: string;
	/**
	 * A single permission to check. Must use this, or permissions.
	 */
	permission?: PermissionCheck;
	/**
	 * Multiple permissions to check. Must use this, or permission.
	 */
	permissions?: PermissionCheck;
}

/**
 * Specifies the permissions required to access a route or controller.
 * Checks user permissions using Better Auth's access control system.
 *
 * Use this for fine-grained permission-based access control.
 *
 * @param options - Permission check options
 * @example
 * ```ts
 * @UserHasPermission({ permission: { project: ["create", "update"] } })
 * @UserHasPermission({ permissions: { project: ["create"], sale: ["create"] } })
 * @UserHasPermission({ role: "admin", permission: { project: ["create"] } })
 * ```
 */
export const UserHasPermission = (
	options: UserHasPermissionOptions,
): ClassOrMethodDecorator => {
	if (!options.permission && !options.permissions) {
		throw new Error(
			"UserHasPermission: Either 'permission' or 'permissions' must be provided",
		);
	}
	return SetMetadata(USER_HAS_PERMISSION_KEY, options);
};

/**
 * Options for the MemberHasPermission decorator
 */
export interface MemberHasPermissionOptions {
	/**
	 * The permissions to check. Must match the structure in your organization access control.
	 */
	permissions: PermissionCheck;
}

/**
 * Specifies the organization member permissions required to access a route or controller.
 * Checks organization member permissions using Better Auth's organization plugin access control.
 * Requires an active organization (`activeOrganizationId` in session).
 *
 * Use this for fine-grained permission-based access control within organizations.
 *
 * @param options - Permission check options
 * @example
 * ```ts
 * @MemberHasPermission({ permissions: { project: ["create", "update"] } })
 * @MemberHasPermission({ permissions: { project: ["create"], sale: ["create"] } })
 * ```
 */
export const MemberHasPermission = (
	options: MemberHasPermissionOptions,
): ClassOrMethodDecorator => {
	if (!options.permissions) {
		throw new Error("MemberHasPermission: 'permissions' must be provided");
	}
	return SetMetadata(MEMBER_HAS_PERMISSION_KEY, options);
};

/**
 * @deprecated Use AllowAnonymous() instead.
 */
export const Public = AllowAnonymous;

/**
 * @deprecated Use OptionalAuth() instead.
 */
export const Optional = OptionalAuth;

/**
 * Parameter decorator that extracts the user session resolved by the AuthGuard.
 * Resolves to `null` when the request has no session (for example on `@OptionalAuth()` routes)
 * and to `undefined` when the AuthGuard did not run for the route.
 */
export const Session: ReturnType<typeof createParamDecorator> =
	createParamDecorator(SESSION_CONTEXT_KEY, (_data, c) =>
		c.get(SESSION_CONTEXT_KEY),
	);
/**
 * Represents the context object passed to hooks.
 * This type is derived from the parameters of the createAuthMiddleware function.
 */
export type AuthHookContext = Parameters<
	Parameters<typeof createAuthMiddleware>[0]
>[0];

/**
 * Registers a method to be executed before a specific auth route is processed.
 * @param path - The auth route path that triggers this hook (must start with '/')
 */
export const BeforeHook = (path?: `/${string}`): MethodDecorator =>
	SetMetadata(BEFORE_HOOK_KEY, path);

/**
 * Registers a method to be executed after a specific auth route is processed.
 * @param path - The auth route path that triggers this hook (must start with '/')
 */
export const AfterHook = (path?: `/${string}`): MethodDecorator =>
	SetMetadata(AFTER_HOOK_KEY, path);

/**
 * Class decorator that marks a service as containing hook methods.
 * Must be applied to classes that use BeforeHook or AfterHook decorators.
 * The class must also be a `@Service()` listed in a module's `services`.
 */
export const Hook = (): ClassDecorator => (target) => {
	Reflect.defineMetadata(HOOK_KEY, true, target);
	registerHookProvider(target as never);
};

/**
 * The models that support database hooks in Better Auth.
 */
export type DatabaseHookModel = "user" | "session" | "account" | "verification";

/**
 * The operations that support database hooks in Better Auth.
 */
export type DatabaseHookOperation = "create" | "update" | "delete";

/**
 * Class decorator that marks a service as containing database hook methods.
 * Must be applied to classes that use database hook method decorators.
 * The class must also be a `@Service()` listed in a module's `services`.
 */
export const DatabaseHook = (): ClassDecorator => (target) => {
	Reflect.defineMetadata(DATABASE_HOOK_KEY, true, target);
	registerHookProvider(target as never);
};

/**
 * Registers a method to be executed before a record is created.
 * @param model - The model to hook into (user, session, account, verification)
 */
export const BeforeCreate = (model: DatabaseHookModel): MethodDecorator =>
	SetMetadata(BEFORE_DATABASE_HOOK_KEY, { model, operation: "create" });

/**
 * Registers a method to be executed after a record is created.
 * @param model - The model to hook into (user, session, account, verification)
 */
export const AfterCreate = (model: DatabaseHookModel): MethodDecorator =>
	SetMetadata(AFTER_DATABASE_HOOK_KEY, { model, operation: "create" });

/**
 * Registers a method to be executed before a record is updated.
 * @param model - The model to hook into (user, session, account, verification)
 */
export const BeforeUpdate = (model: DatabaseHookModel): MethodDecorator =>
	SetMetadata(BEFORE_DATABASE_HOOK_KEY, { model, operation: "update" });

/**
 * Registers a method to be executed after a record is updated.
 * @param model - The model to hook into (user, session, account, verification)
 */
export const AfterUpdate = (model: DatabaseHookModel): MethodDecorator =>
	SetMetadata(AFTER_DATABASE_HOOK_KEY, { model, operation: "update" });

/**
 * Registers a method to be executed before a record is deleted.
 * @param model - The model to hook into (user, session, account, verification)
 */
export const BeforeDelete = (model: DatabaseHookModel): MethodDecorator =>
	SetMetadata(BEFORE_DATABASE_HOOK_KEY, { model, operation: "delete" });

/**
 * Registers a method to be executed after a record is deleted.
 * @param model - The model to hook into (user, session, account, verification)
 */
export const AfterDelete = (model: DatabaseHookModel): MethodDecorator =>
	SetMetadata(AFTER_DATABASE_HOOK_KEY, { model, operation: "delete" });
