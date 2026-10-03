# Honest Better Auth Integration

[Better Auth](https://www.better-auth.com/) for [Honest](https://github.com/kenzuya/honest) (`@kenzuya/honest`), the Nest-style framework on [Hono](https://hono.dev). It mounts Better Auth's routes, guards your controllers with decorators, gives you the session in handlers, and wires Better Auth hooks into Honest's dependency injection.

This package is a port of [`@thallesp/nestjs-better-auth`](https://github.com/ThallesP/nestjs-better-auth) to Honest. See [Migrating from nestjs-better-auth](#migrating-from-nestjs-better-auth) for the differences.

## Installation

```bash
# Using bun
bun add @kenzuya/honest-better-auth @kenzuya/honest better-auth hono reflect-metadata

# Using npm
npm install @kenzuya/honest-better-auth @kenzuya/honest better-auth hono reflect-metadata
```

## Prerequisites

> [!IMPORTANT]
> Requires `better-auth` >= 1.7.0 and `@kenzuya/honest` 0.1.x.

- A working Honest application
- Better Auth (>= 1.7.0) installed and configured ([installation guide](https://www.better-auth.com/docs/installation))
- `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` in your `tsconfig.json` (Honest's dependency injection needs them)

## Basic Setup

**1. Create your Better Auth instance**

```ts title="auth.ts"
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  basePath: "/api/auth", // the default
  emailAndPassword: { enabled: true },
  // database, plugins, ...
});
```

**2. Register the plugin and the guard**

Add `BetterAuthPlugin` to the application's plugins and `AuthGuard` to its global guards:

```ts title="main.ts"
import "reflect-metadata";
import { Application } from "@kenzuya/honest";
import { AuthGuard, BetterAuthPlugin } from "@kenzuya/honest-better-auth";
import { AppModule } from "./app.module";
import { auth } from "./auth";

const { hono } = await Application.create(AppModule, {
  plugins: [new BetterAuthPlugin({ auth })],
  components: { guards: [AuthGuard] },
});

export default hono;
```

The plugin:

- mounts Better Auth's handler on its `basePath` (`/api/auth/*` by default). The `routing.prefix` and `routing.version` options of your app do not apply to it; change the path through `basePath` in your Better Auth config.
- registers `AuthService` and `AuthGuard` in the application's DI container.
- applies CORS for Better Auth's `trustedOrigins` on its routes (see [CORS](#cors)).
- wires [`@Hook()`](#hook-decorators) and [`@DatabaseHook()`](#database-hook-decorators) services into Better Auth.

Hono hands Better Auth the original Web `Request`, so there is no body parser to disable or configure.

## Route Protection

With `AuthGuard` in `components.guards`, every route requires a session unless you allow anonymous access with `@AllowAnonymous()` or make authentication optional with `@OptionalAuth()`. Requests without a session get `401 Unauthorized`; failed role or permission checks get `403 Forbidden`.

To protect only some controllers, leave `AuthGuard` out of the global guards and apply it with `@UseGuards()`:

```ts title="users.controller.ts"
import { Controller, Get, UseGuards } from "@kenzuya/honest";
import { AuthGuard } from "@kenzuya/honest-better-auth";

@UseGuards(AuthGuard)
@Controller("users")
export class UsersController {
  @Get("me")
  getProfile() {
    return { message: "Protected route" };
  }
}
```

The plugin must be registered either way, because the guard gets the Better Auth instance from it.

## Decorators

### Session Decorator

Access the user session in your controllers:

```ts title="users.controller.ts"
import { Controller, Get } from "@kenzuya/honest";
import { Session, type UserSession } from "@kenzuya/honest-better-auth";

@Controller("users")
export class UsersController {
  @Get("me")
  getProfile(@Session() session: UserSession) {
    return session;
  }
}
```

Pass your auth type for plugin fields: `UserSession<typeof auth>` types fields added by plugins such as `username` or `admin`.

### AllowAnonymous and OptionalAuth Decorators

Control authentication requirements for specific routes:

```ts title="users.controller.ts"
import { Controller, Get } from "@kenzuya/honest";
import {
  AllowAnonymous,
  OptionalAuth,
  Session,
  type UserSession,
} from "@kenzuya/honest-better-auth";

@Controller("users")
export class UsersController {
  @Get("public")
  @AllowAnonymous() // Allow anonymous access (no authentication required)
  publicRoute() {
    return { message: "This route is public" };
  }

  @Get("optional")
  @OptionalAuth() // Authentication is optional for this route
  optionalRoute(@Session() session: UserSession | null) {
    return { authenticated: !!session, session };
  }
}
```

Alternatively, use them as class decorators for an entire controller:

```ts title="public.controller.ts"
@AllowAnonymous() // All routes inside this controller are public
@Controller("public")
export class PublicController {
  /* */
}

@OptionalAuth() // Authentication is optional for all routes
@Controller("optional")
export class OptionalController {
  /* */
}
```

A decorator on a route overrides the same decorator on its controller.

### Role-Based Access Control

This library provides two role decorators for different use cases:

| Decorator | Checks | Use Case |
|-----------|--------|----------|
| `@Roles()` | `user.role` only | System-level roles ([admin plugin](https://www.better-auth.com/docs/plugins/admin)) |
| `@RequireActiveOrg()` | Active organization only | Routes that only need `activeOrganizationId` for scoping |
| `@OrgRoles()` | Active organization + organization member role | Organization-level roles ([organization plugin](https://www.better-auth.com/docs/plugins/organization)) |

> [!IMPORTANT]
> These decorators are intentionally **separate** to prevent privilege escalation. The `@Roles()` decorator only checks `user.role` and does **not** check organization member roles. This ensures an organization admin cannot bypass system-level admin protection.

#### @Roles() - System-Level Roles

Use `@Roles()` for system-wide admin protection. This checks only the `user.role` field from Better Auth's [admin plugin](https://www.better-auth.com/docs/plugins/admin).

```ts title="admin.controller.ts"
import { Controller, Get } from "@kenzuya/honest";
import { Roles } from "@kenzuya/honest-better-auth";

@Controller("admin")
export class AdminController {
  @Roles(["admin"])
  @Get("dashboard")
  async adminDashboard() {
    // Only users with user.role = 'admin' can access
    // Organization admins CANNOT access this route
    return { message: "System admin dashboard" };
  }
}

// Or as a class decorator
@Roles(["admin"])
@Controller("admin")
export class AdminController {
  /* All routes require user.role = 'admin' */
}
```

#### @RequireActiveOrg() - Active Organization Only

Use `@RequireActiveOrg()` when a route or controller only needs an active organization context. This requires authentication and `session.activeOrganizationId`, but does not require any specific organization role.

```ts title="projects.controller.ts"
import { Controller, Get } from "@kenzuya/honest";
import {
  RequireActiveOrg,
  Session,
  UserSession,
} from "@kenzuya/honest-better-auth";

@RequireActiveOrg()
@Controller("projects")
export class ProjectsController {
  @Get()
  async listProjects(@Session() session: UserSession) {
    return { orgId: session.session.activeOrganizationId };
  }
}
```

Use this when the controller only needs an active organization ID for scoping data, but authorization is handled elsewhere or organization roles are dynamic.

#### @OrgRoles() - Organization-Level Roles

Use `@OrgRoles()` for organization-scoped protection when you want to require an active organization and one of the specified organization member roles.

```ts title="org.controller.ts"
import { Controller, Get } from "@kenzuya/honest";
import { OrgRoles, Session, UserSession } from "@kenzuya/honest-better-auth";

@Controller("org")
export class OrgController {
  @OrgRoles(["owner", "admin"])
  @Get("settings")
  async getOrgSettings(@Session() session: UserSession) {
    // Only org owners/admins can access (requires activeOrganizationId)
    // System admins (user.role = 'admin') CANNOT access without org context
    return { orgId: session.session.activeOrganizationId };
  }

  @OrgRoles(["owner"])
  @Get("billing")
  async getOrgBilling() {
    // Only org owners can access
    return { message: "Billing settings" };
  }
}
```

> [!NOTE]
> Both role decorators accept any role strings you define. Better Auth's organization plugin provides default roles (`owner`, `admin`, `member`), but you can configure custom roles. The organization creator automatically gets the `owner` role.

### Permission-Based Access Control

This library provides two permission decorators for fine-grained access control:

| Decorator | Checks | Use Case |
|-----------|--------|----------|
| `@UserHasPermission()` | User-level permissions | System-level permissions ([admin plugin access control](https://www.better-auth.com/docs/plugins/admin/access-control)) |
| `@MemberHasPermission()` | Organization member permissions | Organization-level permissions ([organization plugin access control](https://www.better-auth.com/docs/plugins/organization#access-control)) |

#### @UserHasPermission() - System-Level Permissions

Use `@UserHasPermission()` for system-wide permission-based access control. This checks user permissions using Better Auth's [admin plugin access control](https://www.better-auth.com/docs/plugins/admin/access-control).

**Prerequisites:**
- Configure access control in your Better Auth admin plugin

```ts title="auth.ts"
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { createAccessControl } from "better-auth/plugins/access";

const statement = {
  project: ["create", "share", "update", "delete"],
  sale: ["create", "read", "update", "delete"],
} as const;

const ac = createAccessControl(statement);

const editor = ac.newRole({
  project: ["create", "update"],
});

const adminRole = ac.newRole({
  project: ["create", "update", "delete"],
  sale: ["create", "read", "update", "delete"],
});

export const auth = betterAuth({
  plugins: [
    admin({
      ac,
      roles: {
        editor,
        admin: adminRole,
      },
    }),
  ],
});
```

**Usage:**

```ts title="project.controller.ts"
import { Controller, Get, Post } from "@kenzuya/honest";
import { UserHasPermission } from "@kenzuya/honest-better-auth";

@Controller("projects")
export class ProjectController {
  @UserHasPermission({ permission: { project: ["create", "update"] } })
  @Post()
  async createProject() {
    // Only users with project: ["create", "update"] permissions can access
    return { message: "Project created" };
  }

  @UserHasPermission({ permission: { project: ["delete"] } })
  @Post(":id/delete")
  async deleteProject() {
    // Only users with project: ["delete"] permission can access
    return { message: "Project deleted" };
  }

  @UserHasPermission({
    permissions: { project: ["create"], sale: ["create"] },
  })
  @Post("sales")
  async createSale() {
    // Requires both project: ["create"] and sale: ["create"]
    return { message: "Sale created" };
  }
}
```

**Options:**

- `permission`: A single permission check (e.g., `{ project: ["create", "update"] }`)
- `permissions`: Multiple permission checks across resources (e.g., `{ project: ["create"], sale: ["create"] }`)
- `role` (server-only): Check permissions for a specific role
- `userId` (optional): Check permissions for a specific user (defaults to current user)

#### @MemberHasPermission() - Organization-Level Permissions

Use `@MemberHasPermission()` for organization-scoped permission-based access control. This checks organization member permissions using Better Auth's [organization plugin access control](https://www.better-auth.com/docs/plugins/organization#access-control). Requires an active organization (`activeOrganizationId` in session).

**Prerequisites:**
- Configure access control in your Better Auth organization plugin
- Define custom organization roles with permissions

```ts title="auth.ts"
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { createAccessControl } from "better-auth/plugins/access";

const statement = {
  project: ["create", "share", "update", "delete"],
  sale: ["create", "read", "update", "delete"],
  organization: ["update", "delete"],
} as const;

const ac = createAccessControl(statement);

const editor = ac.newRole({
  project: ["create", "update"],
});

const admin = ac.newRole({
  project: ["create", "update", "delete"],
  organization: ["update"],
});

export const auth = betterAuth({
  plugins: [
    organization({
      ac,
      roles: {
        editor,
        admin,
      },
    }),
  ],
});
```

**Usage:**

```ts title="org-project.controller.ts"
import { Controller, Get, Post } from "@kenzuya/honest";
import { MemberHasPermission, Session, UserSession } from "@kenzuya/honest-better-auth";

@Controller("org/projects")
export class OrgProjectController {
  @MemberHasPermission({ permissions: { project: ["create", "update"] } })
  @Post()
  async createProject(@Session() session: UserSession) {
    // Only org members with project: ["create", "update"] permissions can access
    // Requires activeOrganizationId in session
    return {
      message: "Project created",
      orgId: session.session.activeOrganizationId,
    };
  }

  @MemberHasPermission({ permissions: { project: ["delete"] } })
  @Post(":id/delete")
  async deleteProject() {
    // Only org members with project: ["delete"] permission can access
    return { message: "Project deleted" };
  }
}
```

**Options:**

- `permissions`: The permissions to check (required). Must match the structure in your organization access control.


### Hook Decorators

> [!IMPORTANT]
> To use `@Hook`, `@BeforeHook`, `@AfterHook`, set `hooks: {}` (empty object) in your `betterAuth(...)` config. You can still add your own Better Auth hooks; `hooks: {}` (empty object) is just the minimum required.

Minimal Better Auth setup with hooks enabled:

```ts title="auth.ts"
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  basePath: "/api/auth",
  // other better-auth options...
  hooks: {}, // minimum required to use hooks. read above for more details.
});
```

Create hooks as Honest services, so they can inject other services:

```ts title="hooks/sign-up.hook.ts"
import { Service } from "@kenzuya/honest";
import {
  BeforeHook,
  Hook,
  type AuthHookContext,
} from "@kenzuya/honest-better-auth";
import { SignUpService } from "./sign-up.service";

@Hook()
@Service()
export class SignUpHook {
  constructor(private readonly signUpService: SignUpService) {}

  @BeforeHook("/sign-up/email")
  async handle(ctx: AuthHookContext) {
    // Custom logic like enforcing email domain registration
    // Can throw APIError if validation fails
    await this.signUpService.execute(ctx);
  }
}
```

List your hooks in a module's `services`. The plugin wires the hook services that the application has instantiated:

```ts title="app.module.ts"
import { Module } from "@kenzuya/honest";
import { SignUpHook } from "./hooks/sign-up.hook";
import { SignUpService } from "./hooks/sign-up.service";

@Module({
  services: [SignUpHook, SignUpService],
})
export class AppModule {}
```

Without a path, `@BeforeHook()` and `@AfterHook()` run for every Better Auth route.

### Database Hook Decorators

> [!IMPORTANT]
> To use `@DatabaseHook`, `@BeforeCreate`, `@AfterCreate`, `@BeforeUpdate`, `@AfterUpdate`, `@BeforeDelete`, `@AfterDelete`, set `databaseHooks: {}` (empty object) in your `betterAuth(...)` config.

Database hooks let you hook into the lifecycle of core database operations (create, update, delete) for Better Auth models (`user`, `session`, `account`, `verification`).

Minimal Better Auth setup with database hooks enabled:

```ts title="auth.ts"
import { betterAuth } from "better-auth";

export const auth = betterAuth({
  // other better-auth options...
  databaseHooks: {}, // empty object is the minimum required
});
```

Create database hooks as Honest services:

```ts title="hooks/user-create.hook.ts"
import { Service } from "@kenzuya/honest";
import {
  AfterCreate,
  BeforeCreate,
  DatabaseHook,
} from "@kenzuya/honest-better-auth";
import { EmailService } from "./email.service";

@DatabaseHook()
@Service()
export class UserCreateHook {
  constructor(private readonly emailService: EmailService) {}

  @BeforeCreate("user")
  async beforeUserCreate(user) {
    return {
      data: {
        ...user,
        firstName: user.name.split(" ")[0],
        lastName: user.name.split(" ")[1],
      },
    };
  }

  @AfterCreate("user")
  async afterUserCreate(user) {
    await this.emailService.sendWelcomeEmail(user.email);
  }
}
```

Register your database hooks in a module:

```ts title="app.module.ts"
import { Module } from "@kenzuya/honest";
import { UserCreateHook } from "./hooks/user-create.hook";
import { EmailService } from "./hooks/email.service";

@Module({
  services: [UserCreateHook, EmailService],
})
export class AppModule {}
```

Available method decorators:

| Decorator | Description |
|-----------|-------------|
| `@BeforeCreate(model)` | Runs before a record is created |
| `@AfterCreate(model)` | Runs after a record is created |
| `@BeforeUpdate(model)` | Runs before a record is updated |
| `@AfterUpdate(model)` | Runs after a record is updated |
| `@BeforeDelete(model)` | Runs before a record is deleted |
| `@AfterDelete(model)` | Runs after a record is deleted |

Where `model` is one of: `"user"`, `"session"`, `"account"`, `"verification"`.

`before` hooks can return `false` to abort the operation, or `{ data: ... }` to modify the data before it's written. `after` hooks are for side effects only.

## AuthService

The plugin registers `AuthService` in the DI container. Inject it into controllers and services to use the Better Auth instance and its API endpoints:

```ts title="users.controller.ts"
import { Body, Controller, Get, Post, Req } from "@kenzuya/honest";
import { AuthService } from "@kenzuya/honest-better-auth";
import type { HonoRequest } from "hono";
import type { auth } from "../auth";

@Controller("users")
export class UsersController {
  constructor(private readonly authService: AuthService<typeof auth>) {}

  @Get("accounts")
  async getAccounts(@Req() req: HonoRequest) {
    // Pass the request headers to the auth API
    const accounts = await this.authService.api.listUserAccounts({
      headers: req.raw.headers,
    });

    return { accounts };
  }

  @Post("api-keys")
  async createApiKey(@Req() req: HonoRequest, @Body() body) {
    // Access plugin-specific functionality with request headers
    // createApiKey is a method added by a plugin, not part of the core API
    return this.authService.api.createApiKey({
      body,
      headers: req.raw.headers,
    });
  }
}
```

When using plugins that extend the Auth type with additional functionality, use generics to access the extended features as shown above with `AuthService<typeof auth>`. This ensures type safety when using plugin-specific API methods like `createApiKey`. `authService.instance` returns the whole Better Auth instance.

## Context Variables

`AuthGuard` stores what it resolved in Hono context variables, available to handlers, later guards, pipes and filters:

| Variable  | Value                                                    |
| --------- | -------------------------------------------------------- |
| `session` | The full session (`{ session, user }`), or `null`        |
| `user`    | The session's user, or `null` (useful for observability tools like Sentry) |

```ts
import { Controller, Ctx, Get, Var } from "@kenzuya/honest";
import type { Context } from "hono";

@Controller("users")
export class UsersController {
  @Get("me")
  getProfile(@Var("user") user: unknown, @Ctx() c: Context) {
    return { user, session: c.get("session") };
  }
}
```

The variable names are exported as `SESSION_CONTEXT_KEY` and `USER_CONTEXT_KEY`.

## Plugin Options

```ts
new BetterAuthPlugin({
  auth,
  disableTrustedOriginsCors: false,
  disableControllers: false,
  middleware: undefined,
});
```

| Option                      | Default     | Description |
| --------------------------- | ----------- | ----------- |
| `auth`                      | (required)  | Your Better Auth instance. |
| `disableTrustedOriginsCors` | `false`     | When `true`, does not apply CORS for `trustedOrigins` on Better Auth routes. |
| `disableControllers`        | `false`     | When `true`, does not mount Better Auth's routes (or their CORS). `AuthService`, `AuthGuard` and hooks keep working. Use this to mount the handler yourself. |
| `middleware`                | `undefined` | Hono middleware `(c, next)` that runs before Better Auth's handler on its routes. |

### CORS

If your Better Auth config sets `trustedOrigins`, the plugin applies [`hono/cors`](https://hono.dev/docs/middleware/builtin/cors) to Better Auth routes with `credentials: true`, allowing exactly those origins. `trustedOrigins` can be an array or a function; a function is called with the request.

The CORS middleware covers Better Auth routes only. Add your own CORS for the rest of your API, for example a global Honest middleware that wraps Hono's `cors()`. Set `disableTrustedOriginsCors: true` to manage CORS for Better Auth routes yourself.

### Using Custom Middleware

`middleware` runs before Better Auth's handler, for example to set up request-scoped state:

```ts
new BetterAuthPlugin({
  auth,
  middleware: async (c, next) => {
    const startedAt = Date.now();
    await next();
    console.log(`${c.req.method} ${c.req.path} took ${Date.now() - startedAt}ms`);
  },
});
```

The middleware can also return a response itself to stop the request before it reaches Better Auth. Errors it throws go to the application's `onError` handler.

## Migrating from nestjs-better-auth

| NestJS (`@thallesp/nestjs-better-auth`)           | Honest (`@kenzuya/honest-better-auth`) |
| ------------------------------------------------- | -------------------------------------- |
| `AuthModule.forRoot({ auth })` / `forRootAsync()` | `plugins: [new BetterAuthPlugin({ auth })]` |
| Global `AuthGuard` by default, `disableGlobalAuthGuard` | `components: { guards: [AuthGuard] }` or `@UseGuards(AuthGuard)` |
| `@Injectable()` hook providers in `providers`      | `@Service()` hook classes in `services` |
| `req.session` / `req.user`                         | `@Session()`, `@Var("user")` or `c.get("session")` |
| `middleware: (req, res, next) => ...`              | `middleware: async (c, next) => ...` (Hono) |
| `bodyParser`, `disableBodyParser`, `enableRawBodyParser` | Not needed: Hono doesn't pre-parse bodies, use `c.req.raw` for the raw body |
| GraphQL resolvers and WebSocket gateways           | Not supported (Honest has no GraphQL or WebSocket layer) |
| Function-based `trustedOrigins` unsupported        | Supported |

## Example

[`examples/basic`](./examples/basic) is a small notes API using the plugin, the global guard, `@Session()` and a sign-up hook.
