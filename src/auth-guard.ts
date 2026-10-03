import {
	HONEST_PIPELINE_CONTROLLER_KEY,
	HONEST_PIPELINE_HANDLER_KEY,
	type IGuard,
} from "@kenzuya/honest";
import type { getSession } from "better-auth/api";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { AuthService } from "./auth-service.ts";
import type { Auth } from "./better-auth-plugin.ts";
import { getAllAndOverride } from "./metadata.ts";
import {
	MEMBER_HAS_PERMISSION_KEY,
	OPTIONAL_KEY,
	ORG_ROLES_KEY,
	PUBLIC_KEY,
	REQUIRE_ACTIVE_ORG_KEY,
	ROLES_KEY,
	SESSION_CONTEXT_KEY,
	USER_CONTEXT_KEY,
	USER_HAS_PERMISSION_KEY,
} from "./symbols.ts";

/**
 * Type representing a valid user session after authentication
 * Excludes null and undefined values from the session return type
 */
export type BaseUserSession = NonNullable<
	Awaited<ReturnType<ReturnType<typeof getSession>>>
>;

/**
 * Type representing a user session with plugin-aware type inference.
 *
 * Pass your auth instance type to get full type safety for plugin fields:
 *
 * @example
 * ```ts
 * const auth = betterAuth({ plugins: [username(), admin()] });
 *
 * @Get('me')
 * getMe(@Session() session: UserSession<typeof auth>) {
 *   session.user.username; // ✅ typed correctly
 * }
 * ```
 */
export type UserSession<T = unknown> = T extends {
	$Infer: { Session: infer S };
}
	? S
	: BaseUserSession & {
			user: BaseUserSession["user"] & {
				role?: string | string[];
			};
			session: BaseUserSession["session"] & {
				activeOrganizationId?: string;
			};
		};

const unauthorized = (message = "Unauthorized") =>
	new HTTPException(401, { message });

const forbidden = (message = "Insufficient permissions") =>
	new HTTPException(403, { message });

/**
 * Returns the route handler and controller class of the current request, which Honest records in
 * the context before guards run. Metadata is read from them in that order.
 */
function getMetadataTargets(c: Context): (object | undefined)[] {
	const controllerClass = c.get(HONEST_PIPELINE_CONTROLLER_KEY) as
		| (new (
				...args: unknown[]
		  ) => unknown)
		| undefined;
	const handlerName = c.get(HONEST_PIPELINE_HANDLER_KEY) as
		| string
		| symbol
		| undefined;
	const handler =
		controllerClass && handlerName !== undefined
			? (controllerClass.prototype as Record<string | symbol, unknown>)[
					handlerName
				]
			: undefined;

	return [handler as object | undefined, controllerClass];
}

/**
 * Honest guard that handles authentication for protected routes.
 * Register it globally with `components: { guards: [AuthGuard] }` or per controller/route with
 * `@UseGuards(AuthGuard)`. Can be configured with @AllowAnonymous() or @OptionalAuth() decorators
 * to modify authentication behavior.
 */
export class AuthGuard implements IGuard {
	// The default keeps the constructor arity at 0; the BetterAuthPlugin registers a configured instance.
	constructor(
		private readonly authService: AuthService<Auth> = new AuthService<Auth>(),
	) {}

	/**
	 * Validates if the current request is authenticated
	 * Stores the session and user in the context variables "session" and "user"
	 * @param c - The Hono context of the current request
	 * @returns True if the request is authorized to proceed, throws an HTTPException otherwise
	 */
	async canActivate(c: Context): Promise<boolean> {
		const headers = c.req.raw.headers;
		const session: UserSession | null = await this.authService.api.getSession({
			headers,
		});

		c.set(SESSION_CONTEXT_KEY, session);
		c.set(USER_CONTEXT_KEY, session?.user ?? null); // useful for observability tools like Sentry

		const targets = getMetadataTargets(c);

		const isPublic = getAllAndOverride<boolean>(PUBLIC_KEY, targets);

		if (isPublic) return true;

		const isOptional = getAllAndOverride<boolean>(OPTIONAL_KEY, targets);

		if (!session && isOptional) return true;

		if (!session) throw unauthorized();

		const requireActiveOrg = getAllAndOverride<boolean>(
			REQUIRE_ACTIVE_ORG_KEY,
			targets,
		);

		if (requireActiveOrg && !session.session?.activeOrganizationId) {
			throw forbidden("Active organization is required");
		}

		// Check @Roles() - user.role only (admin plugin)
		const requiredRoles = getAllAndOverride<string[]>(ROLES_KEY, targets);

		if (requiredRoles && requiredRoles.length > 0) {
			const hasRole = this.checkUserRole(session, requiredRoles);
			if (!hasRole) throw forbidden();
		}

		// Check @OrgRoles() - organization member role only
		const requiredOrgRoles = getAllAndOverride<string[]>(
			ORG_ROLES_KEY,
			targets,
		);

		if (requiredOrgRoles && requiredOrgRoles.length > 0) {
			const hasOrgRole = await this.checkOrgRole(
				session,
				headers,
				requiredOrgRoles,
			);
			if (!hasOrgRole) throw forbidden();
		}

		// Check @UserHasPermission() - permission-based access control
		const permissionCheck = getAllAndOverride<{
			userId?: string;
			role?: string;
			permission?: Record<string, string[]>;
			permissions?: Record<string, string[]>;
		}>(USER_HAS_PERMISSION_KEY, targets);

		if (permissionCheck) {
			const hasPermission = await this.checkUserPermission(
				session,
				headers,
				permissionCheck,
			);
			if (!hasPermission) throw forbidden();
		}

		// Check @MemberHasPermission() - organization member permission-based access control
		const memberPermissionCheck = getAllAndOverride<{
			permissions: Record<string, string[]>;
		}>(MEMBER_HAS_PERMISSION_KEY, targets);

		if (memberPermissionCheck) {
			const hasMemberPermission = await this.checkMemberPermission(
				session,
				headers,
				memberPermissionCheck,
			);
			if (!hasMemberPermission) throw forbidden();
		}

		return true;
	}

	/**
	 * Checks if a role value matches any of the required roles
	 * Handles both array and comma-separated string role formats
	 * @param role - The role value to check (string, array, or undefined)
	 * @param requiredRoles - Array of roles that grant access
	 * @returns True if the role matches any required role
	 */
	private matchesRequiredRole(
		role: string | string[] | undefined,
		requiredRoles: string[],
	): boolean {
		if (!role) return false;

		if (Array.isArray(role)) {
			return role.some((r) => requiredRoles.includes(r));
		}

		if (typeof role === "string") {
			return role.split(",").some((r) => requiredRoles.includes(r.trim()));
		}

		return false;
	}

	/**
	 * Fetches the user's role within an organization from the member table
	 * Uses Better Auth's organization plugin API if available
	 * @param headers - The request headers containing session cookies
	 * @returns The member's role in the organization, or undefined if not found
	 */
	private async getMemberRoleInOrganization(
		headers: Headers,
	): Promise<string | undefined> {
		// Better Auth organization plugin exposes getActiveMemberRole or getActiveMember API
		// biome-ignore lint/suspicious/noExplicitAny: Better Auth API types vary by plugin configuration
		const authApi = this.authService.api as any;

		// Try getActiveMemberRole first (most direct for our use case)
		if (typeof authApi.getActiveMemberRole === "function") {
			const result = await authApi.getActiveMemberRole({ headers });
			return result?.role;
		}

		// Fallback: try getActiveMember
		if (typeof authApi.getActiveMember === "function") {
			const member = await authApi.getActiveMember({ headers });
			return member?.role;
		}

		return undefined;
	}

	/**
	 * Checks if the user has any of the required roles in user.role only.
	 * Used by @Roles() decorator for system-level role checks (admin plugin).
	 * @param session - The user's session
	 * @param requiredRoles - Array of roles that grant access
	 * @returns True if user.role matches any required role
	 */
	private checkUserRole(
		session: UserSession,
		requiredRoles: string[],
	): boolean {
		return this.matchesRequiredRole(session.user.role, requiredRoles);
	}

	/**
	 * Checks if the user has any of the required roles in their organization.
	 * Used by @OrgRoles() decorator for organization-level role checks.
	 * Requires an active organization in the session.
	 * @param session - The user's session
	 * @param headers - The request headers for API calls
	 * @param requiredRoles - Array of roles that grant access
	 * @returns True if org member role matches any required role
	 */
	private async checkOrgRole(
		session: UserSession,
		headers: Headers,
		requiredRoles: string[],
	): Promise<boolean> {
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return false;
		}

		try {
			const memberRole = await this.getMemberRoleInOrganization(headers);
			return this.matchesRequiredRole(memberRole, requiredRoles);
		} catch (error) {
			// Log error for debugging but return false to trigger 403 Forbidden
			// instead of letting the error propagate as a 500
			console.error("Organization plugin error:", error);
			return false;
		}
	}

	/**
	 * Checks if the user has the required permissions.
	 * Used by @UserHasPermission() decorator for permission-based access control.
	 * Calls Better Auth's userHasPermission API to verify permissions.
	 * @param session - The user's session
	 * @param headers - The request headers for API calls
	 * @param permissionCheck - The permission check options
	 * @returns True if user has the required permissions
	 */
	private async checkUserPermission(
		session: UserSession,
		headers: Headers,
		permissionCheck: {
			userId?: string;
			role?: string;
			permission?: Record<string, string[]>;
			permissions?: Record<string, string[]>;
		},
	): Promise<boolean> {
		try {
			// biome-ignore lint/suspicious/noExplicitAny: Better Auth API types vary by plugin configuration
			const authApi = this.authService.api as any;

			// Check if userHasPermission API is available
			if (typeof authApi.userHasPermission !== "function") {
				console.error(
					"userHasPermission API not available. Make sure access control is configured in Better Auth.",
				);
				return false;
			}

			// Build the request body
			const body: {
				userId?: string;
				role?: string;
				permissions?: Record<string, string[]>;
			} = {};

			// Use provided userId or default to current user's ID
			if (permissionCheck.userId) {
				body.userId = permissionCheck.userId;
			} else if (session.user.id) {
				body.userId = session.user.id;
			}

			// Add role if provided (server-only)
			if (permissionCheck.role) {
				body.role = permissionCheck.role;
			}

			// Better Auth expects the pluralized payload shape.
			if (permissionCheck.permission) {
				body.permissions = permissionCheck.permission;
			} else if (permissionCheck.permissions) {
				body.permissions = permissionCheck.permissions;
			}

			// Call the Better Auth userHasPermission API
			const result = await authApi.userHasPermission({
				body,
				headers,
			});
			if (result?.success) {
				return true;
			}

			return false;
		} catch (error) {
			// Log error for debugging but return false to trigger 403 Forbidden
			// instead of letting the error propagate as a 500
			console.error("Permission check error:", error);
			console.error(
				"Permission check body:",
				JSON.stringify(permissionCheck, null, 2),
			);
			return false;
		}
	}

	/**
	 * Checks if the organization member has the required permissions.
	 * Used by @MemberHasPermission() decorator for organization member permission-based access control.
	 * Calls Better Auth's organization plugin hasPermission API to verify permissions.
	 * Requires an active organization in the session.
	 * @param session - The user's session
	 * @param headers - The request headers for API calls
	 * @param permissionCheck - The permission check options
	 * @returns True if member has the required permissions
	 */
	private async checkMemberPermission(
		session: UserSession,
		headers: Headers,
		permissionCheck: {
			permissions: Record<string, string[]>;
		},
	): Promise<boolean> {
		// Require an active organization (like @OrgRoles)
		const activeOrgId = session.session?.activeOrganizationId;
		if (!activeOrgId) {
			return false;
		}

		try {
			// biome-ignore lint/suspicious/noExplicitAny: Better Auth API types vary by plugin configuration
			const authApi = this.authService.api as any;

			// Check if hasPermission API is available (organization plugin)
			if (typeof authApi.hasPermission !== "function") {
				console.error(
					"hasPermission API not available. Make sure organization plugin with access control is configured in Better Auth.",
				);
				return false;
			}

			// Build the request body - organization plugin only uses permissions
			const body: {
				permissions: Record<string, string[]>;
			} = {
				permissions: permissionCheck.permissions,
			};

			// Call the Better Auth organization plugin hasPermission API
			const result = await authApi.hasPermission({
				body,
				headers,
			});

			if (result?.success) {
				return true;
			}

			return false;
		} catch (error) {
			// Log error for debugging but return false to trigger 403 Forbidden
			// instead of letting the error propagate as a 500
			console.error("Member permission check error:", error);
			console.error(
				"Member permission check body:",
				JSON.stringify(permissionCheck, null, 2),
			);
			return false;
		}
	}
}
