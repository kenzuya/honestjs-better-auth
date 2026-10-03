import { type DiContainer, MetadataRegistry } from "@kenzuya/honest";
import { createAuthMiddleware } from "better-auth/api";
import type { DatabaseHookModel, DatabaseHookOperation } from "./decorators.ts";
import { getAllMethodNames, getHookProviders } from "./metadata.ts";
import {
	AFTER_DATABASE_HOOK_KEY,
	AFTER_HOOK_KEY,
	BEFORE_DATABASE_HOOK_KEY,
	BEFORE_HOOK_KEY,
	DATABASE_HOOK_KEY,
	HOOK_KEY,
} from "./symbols.ts";

type HookFn = (...args: unknown[]) => unknown;
type HookType = "before" | "after";

type DatabaseHookSlot = Partial<Record<HookType, HookFn>>;
type DatabaseHooks = Partial<
	Record<string, Partial<Record<string, DatabaseHookSlot>>>
>;

/**
 * The parts of Better Auth's context (`await auth.$context`) the plugin uses.
 */
export interface BetterAuthContext {
	baseURL: string;
	trustedOrigins: string[];
	isTrustedOrigin(url: string): boolean;
	options: {
		basePath?: string;
		trustedOrigins?:
			| string[]
			| ((
					request?: Request,
			  ) =>
					| (string | null | undefined)[]
					| Promise<(string | null | undefined)[]>);
		plugins?: unknown[];
		databaseHooks?: DatabaseHooks;
	};
}

interface RequestHookBinding {
	hookType: HookType;
	path?: string;
	handler: HookFn;
}

interface DatabaseHookBinding {
	model: DatabaseHookModel;
	operation: DatabaseHookOperation;
	hookType: HookType;
	handler: HookFn;
}

interface HookPlugin {
	id: string;
	hooks: { before: unknown[]; after: unknown[] };
}

const REQUEST_HOOKS = [
	{ metadataKey: BEFORE_HOOK_KEY, hookType: "before" as const },
	{ metadataKey: AFTER_HOOK_KEY, hookType: "after" as const },
];

const DATABASE_HOOKS = [
	{ metadataKey: BEFORE_DATABASE_HOOK_KEY, hookType: "before" as const },
	{ metadataKey: AFTER_DATABASE_HOOK_KEY, hookType: "after" as const },
];

const HOOK_PLUGIN_ID = "honest-better-auth";

// State is kept per Better Auth instance, so creating another application with the same instance
// replaces the hooks of the previous one instead of stacking them.
const hookPlugins = new WeakMap<BetterAuthContext, HookPlugin>();
const databaseHookSlots = new WeakMap<DatabaseHooks, Map<string, HookFn[]>>();

/**
 * Wires the `@Hook()` and `@DatabaseHook()` services the container has instantiated into Better Auth,
 * replacing the ones a previous application registered on the same Better Auth instance.
 */
export function registerHooks(
	ctx: BetterAuthContext,
	container: DiContainer,
): void {
	const { request, database } = collectHooks(container);

	if (
		database.length > 0 &&
		(typeof ctx.options.databaseHooks !== "object" ||
			ctx.options.databaseHooks === null)
	) {
		throw new Error(
			"Detected @DatabaseHook providers but Better Auth 'databaseHooks' is not configured. Add an empty 'databaseHooks: {}' object to your betterAuth(...) options.",
		);
	}

	registerRequestHooks(ctx, request);
	registerDatabaseHooks(ctx, database);
}

/**
 * Collects the hook methods of instantiated services. Candidates are all `@Service()` classes, which
 * covers subclasses inheriting `@Hook()`, plus classes decorated directly.
 */
function collectHooks(container: DiContainer): {
	request: RequestHookBinding[];
	database: DatabaseHookBinding[];
} {
	const request: RequestHookBinding[] = [];
	const database: DatabaseHookBinding[] = [];
	const candidates = new Set([
		...MetadataRegistry.getAllServices(),
		...getHookProviders(),
	]);

	for (const provider of candidates) {
		const isHook = Reflect.getMetadata(HOOK_KEY, provider) === true;
		const isDatabaseHook =
			Reflect.getMetadata(DATABASE_HOOK_KEY, provider) === true;
		if ((!isHook && !isDatabaseHook) || !container.has(provider)) continue;

		const instance = container.resolve(provider) as object;
		const prototype = Object.getPrototypeOf(instance) as Record<string, HookFn>;

		for (const methodName of getAllMethodNames(prototype)) {
			const method = prototype[methodName];
			const handler: HookFn = (...args) => method.apply(instance, args);

			if (isHook) {
				for (const { metadataKey, hookType } of REQUEST_HOOKS) {
					if (!Reflect.hasMetadata(metadataKey, method)) continue;
					request.push({
						hookType,
						path: Reflect.getMetadata(metadataKey, method),
						handler,
					});
				}
			}

			if (isDatabaseHook) {
				for (const { metadataKey, hookType } of DATABASE_HOOKS) {
					if (!Reflect.hasMetadata(metadataKey, method)) continue;
					const { model, operation } = Reflect.getMetadata(
						metadataKey,
						method,
					) as { model: DatabaseHookModel; operation: DatabaseHookOperation };
					database.push({ model, operation, hookType, handler });
				}
			}
		}
	}

	return { request, database };
}

/**
 * Registers request hooks as the hooks of a Better Auth plugin, so Better Auth runs each one with its
 * own semantics: a before hook can return `{ context }` or a response, an after hook can replace
 * the response. The user's own `hooks` option is left untouched.
 */
function registerRequestHooks(
	ctx: BetterAuthContext,
	bindings: RequestHookBinding[],
): void {
	let plugin = hookPlugins.get(ctx);
	if (!plugin) {
		if (bindings.length === 0) return;
		plugin = { id: HOOK_PLUGIN_ID, hooks: { before: [], after: [] } };
		ctx.options.plugins ??= [];
		ctx.options.plugins.push(plugin);
		hookPlugins.set(ctx, plugin);
	}

	const toBetterAuthHook = ({ path, handler }: RequestHookBinding) => ({
		matcher: (context: { path?: string }) => !path || context.path === path,
		handler: createAuthMiddleware(async (context) => handler(context)),
	});

	plugin.hooks.before = bindings
		.filter(({ hookType }) => hookType === "before")
		.map(toBetterAuthHook);
	plugin.hooks.after = bindings
		.filter(({ hookType }) => hookType === "after")
		.map(toBetterAuthHook);
}

/**
 * Better Auth reads database hooks from the `databaseHooks` object it got at startup, so each
 * `databaseHooks[model][operation][hookType]` slot gets one dispatcher that runs the user's hook and
 * then the registered ones.
 */
function registerDatabaseHooks(
	ctx: BetterAuthContext,
	bindings: DatabaseHookBinding[],
): void {
	const databaseHooks = ctx.options.databaseHooks;
	if (!databaseHooks) return;

	let slots = databaseHookSlots.get(databaseHooks);
	if (!slots) {
		if (bindings.length === 0) return;
		slots = new Map();
		databaseHookSlots.set(databaseHooks, slots);
	}

	for (const handlers of slots.values()) handlers.length = 0;

	for (const { model, operation, hookType, handler } of bindings) {
		const key = `${model}.${operation}.${hookType}`;
		let handlers = slots.get(key);
		if (!handlers) {
			handlers = [];
			slots.set(key, handlers);
			installDatabaseHookDispatcher(
				databaseHooks,
				model,
				operation,
				hookType,
				handlers,
			);
		}
		handlers.push(handler);
	}
}

function installDatabaseHookDispatcher(
	databaseHooks: DatabaseHooks,
	model: DatabaseHookModel,
	operation: DatabaseHookOperation,
	hookType: HookType,
	handlers: HookFn[],
): void {
	databaseHooks[model] ??= {};
	const operations = databaseHooks[model];
	operations[operation] ??= {};
	const slot = operations[operation];
	const original = slot[hookType];
	const getHooks = () => (original ? [original, ...handlers] : [...handlers]);

	slot[hookType] =
		hookType === "before"
			? (data, context) => runBeforeDatabaseHooks(getHooks(), data, context)
			: async (...args) => {
					for (const hook of getHooks()) await hook(...args);
				};
}

/**
 * Chains before hooks the way Better Auth runs separate hook sources: `false` aborts the operation,
 * and `{ data }` is merged into the data the next hook receives.
 */
async function runBeforeDatabaseHooks(
	hooks: HookFn[],
	data: unknown,
	context: unknown,
): Promise<false | { data: unknown } | undefined> {
	let current = data;
	let modified = false;

	for (const hook of hooks) {
		const result = await hook(current, context);
		if (result === false) return false;
		if (typeof result === "object" && result !== null && "data" in result) {
			current = {
				...(current as object),
				...((result as { data: object }).data ?? {}),
			};
			modified = true;
		}
	}

	return modified ? { data: current } : undefined;
}
