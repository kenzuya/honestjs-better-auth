import { Body, Controller, Get, Post, Var } from "@kenzuya/honest";
import type { UserSession } from "../../src/auth-guard.ts";
import {
	AllowAnonymous,
	OptionalAuth,
	OrgRoles,
	RequireActiveOrg,
	Roles,
	Session,
} from "../../src/decorators.ts";

// Simple controller with one protected route and one public route
@Controller("test")
export class TestController {
	@Get("protected")
	protected(@Var("user") user: unknown) {
		return { user };
	}

	@AllowAnonymous()
	@Get("public")
	public() {
		return { ok: true };
	}

	@OptionalAuth()
	@Get("optional")
	optional(@Session() session: UserSession | null) {
		return { authenticated: !!session?.user, session };
	}

	@Roles(["admin"])
	@Get("admin-protected")
	adminProtected(@Var("user") user: unknown) {
		return { user };
	}

	@Roles(["admin", "moderator"])
	@Get("admin-moderator-protected")
	adminModeratorProtected(@Var("user") user: unknown) {
		return { user };
	}

	@RequireActiveOrg()
	@Get("active-org-protected")
	activeOrgProtected(@Session() session: UserSession) {
		return { user: session.user, session };
	}

	@OrgRoles(["owner"])
	@Get("org-owner-protected")
	orgOwnerProtected(@Var("user") user: unknown) {
		return { user };
	}

	@OrgRoles(["owner", "admin"])
	@Get("org-owner-admin-protected")
	orgOwnerAdminProtected(@Var("user") user: unknown) {
		return { user };
	}

	@OrgRoles(["admin"])
	@Get("org-admin-protected")
	orgAdminProtected(@Var("user") user: unknown) {
		return { user };
	}

	@OrgRoles(["member"])
	@Get("org-member-protected")
	orgMemberProtected(@Var("user") user: unknown) {
		return { user };
	}

	@AllowAnonymous()
	@Post("json-body")
	jsonBody(@Body() body: unknown) {
		return {
			hasBody: body !== undefined,
			body: body ?? null,
		};
	}
}

@RequireActiveOrg()
@Controller("active-org-controller")
export class ActiveOrgController {
	@Get("projects")
	projects(@Session() session: UserSession) {
		return { user: session.user, session };
	}
}
